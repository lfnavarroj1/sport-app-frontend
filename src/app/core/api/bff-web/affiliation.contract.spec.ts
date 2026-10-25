import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import {
  ACCOUNT_STATEMENT_PATH,
  ACCOUNT_STATEMENT_RESPONSES,
  SIMULATED_STATEMENT_PAGE_SIZE,
} from '../../../../testing/bff-web/account-statement.fixtures';
import {
  MY_SUBSCRIPTION_PATH,
  MY_SUBSCRIPTION_RESPONSES,
  PLANS_PATH,
  PLANS_RESPONSES,
  SUBSCRIPTION_CHANGES_PATH,
  SUBSCRIPTION_CHANGE_RESPONSES,
  VALID_SUBSCRIPTION_CHANGE_REQUEST,
} from '../../../../testing/bff-web/affiliation.fixtures';
import {
  OpenApiDocument,
  OpenApiOperation,
  responseSchema,
  validateAgainstSchema,
} from '../../../../testing/openapi-schema';
import { APP_CONFIG } from '../../config/app-config';
import contractJson from '../contracts/bff-web.openapi.json';
import {
  ACCOUNT_STATEMENT_ERROR_CODES,
  AFFILIATION_QUERY_ERROR_CODES,
  AccountStatementResponseDto,
  COMMITMENT_STATUSES,
  CommitmentItemDto,
  MOVEMENT_TYPES,
  MovementItemDto,
  BffWebAffiliationApi,
  PERIODICITIES,
  PlanDto,
  PlanOfferDto,
  PlansResponseDto,
  SUBSCRIPTION_CHANGE_ERROR_CODES,
  SUBSCRIPTION_IDEMPOTENT_REPLAYED_HEADER,
  STATEMENT_STATUSES,
  SUBSCRIPTION_STATUSES,
  SubscriptionChangeRequestDto,
  SubscriptionResponseDto,
} from './affiliation.api';
import { BFF_WEB_CONTRACT_VERSION } from './contract';

const contract = contractJson as unknown as OpenApiDocument;
const schemas = contract.components.schemas as Record<string, Record<string, unknown>>;

const operations = {
  plans: contract.paths[PLANS_PATH]['get'],
  subscription: contract.paths[MY_SUBSCRIPTION_PATH]['get'],
  change: contract.paths[SUBSCRIPTION_CHANGES_PATH]['post'],
} satisfies Record<string, OpenApiOperation>;

/** Códigos declarados: antes de los dos puntos y sin el texto entre paréntesis. */
function declaredCodes(operation: OpenApiOperation, statuses: number[]): string[] {
  return statuses
    .flatMap((status) => {
      const description = operation.responses[String(status)]?.description ?? '';
      const codes = description.split(':')[0].replace(/\([^)]*\)/g, '');
      return [...codes.matchAll(/`([a-z_]+)`/g)].map((match) => match[1]);
    })
    .sort();
}

function requiredProperties(schema: string): string[] {
  return [...(schemas[schema]['required'] as string[])].sort();
}

function property(schema: string, name: string): Record<string, unknown> {
  return (schemas[schema]['properties'] as Record<string, Record<string, unknown>>)[name];
}

function headerNames(operation: OpenApiOperation): string[][] {
  return (operation.parameters ?? [])
    .filter((parameter) => parameter.in === 'header')
    .map((parameter) => [parameter.name.toLowerCase(), String(parameter.required ?? false)]);
}

describe('Contrato bff-web: operaciones de HU016', () => {
  it('usa la versión del contrato y sus operationId', () => {
    expect(contract.info.version).toBe(BFF_WEB_CONTRACT_VERSION);
    expect(operations.plans.operationId).toBe('plans_v1_plans_get');
    expect(operations.subscription.operationId).toBe('my_subscription_v1_me_subscription_get');
    expect(operations.change.operationId).toBe('change_v1_me_subscription_changes_post');
  });

  it('todas se autentican con Authorization; el cambio exige Idempotency-Key y expone Idempotent-Replayed', () => {
    expect(headerNames(operations.plans)).toEqual([['authorization', 'false']]);
    expect(headerNames(operations.subscription)).toEqual([['authorization', 'false']]);
    expect(headerNames(operations.change)).toEqual([
      ['idempotency-key', 'true'],
      ['authorization', 'false'],
    ]);
    expect(Object.keys(operations.change.responses['200'].headers ?? {})).toContain(
      SUBSCRIPTION_IDEMPOTENT_REPLAYED_HEADER,
    );
  });

  it('la solicitud del cliente tiene exactamente las propiedades del contrato', () => {
    const body: SubscriptionChangeRequestDto = VALID_SUBSCRIPTION_CHANGE_REQUEST;

    expect(Object.keys(body).sort()).toEqual(requiredProperties('SubscriptionChangeRequest'));
    expect(
      validateAgainstSchema(
        contract,
        operations.change.requestBody!.content['application/json'].schema,
        body,
      ),
    ).toEqual([]);
  });

  it('las respuestas del cliente tienen exactamente las propiedades obligatorias del contrato', () => {
    const plans: PlansResponseDto = PLANS_RESPONSES.free.body;
    const plan: PlanDto = plans.plans[1];
    const offer: PlanOfferDto = plan.offers[0];
    const subscription: SubscriptionResponseDto = MY_SUBSCRIPTION_RESPONSES.free.body;

    expect(Object.keys(plans).sort()).toEqual(requiredProperties('PlansResponse'));
    expect(Object.keys(plan).sort()).toEqual(requiredProperties('PlanResponse'));
    expect(Object.keys(offer).sort()).toEqual(requiredProperties('PlanOfferResponse'));
    expect(Object.keys(subscription).sort()).toEqual(requiredProperties('SubscriptionResponse'));
  });

  it('las periodicidades y los estados coinciden con el contrato', () => {
    expect<string[]>([...PERIODICITIES]).toEqual(
      property('SubscriptionChangeRequest', 'periodicity')['enum'] as string[],
    );
    expect<string[]>([...PERIODICITIES]).toEqual(
      property('PlanOfferResponse', 'periodicity')['enum'] as string[],
    );
    expect<string[]>([...SUBSCRIPTION_STATUSES]).toEqual(
      property('SubscriptionResponse', 'status')['enum'] as string[],
    );
  });

  it('los códigos de error del cliente son los que declara el contrato', () => {
    for (const operation of [operations.plans, operations.subscription]) {
      expect<string[]>(Object.values(AFFILIATION_QUERY_ERROR_CODES).sort()).toEqual(
        declaredCodes(operation, [401, 403, 503, 504]),
      );
    }
    expect<string[]>(Object.values(SUBSCRIPTION_CHANGE_ERROR_CODES).sort()).toEqual(
      declaredCodes(operations.change, [401, 403, 404, 409, 422, 503, 504]),
    );
  });

  const simulated: [string, OpenApiOperation, Record<string, { status: number; body: unknown }>][] =
    [
      ['GET /v1/plans', operations.plans, PLANS_RESPONSES],
      ['GET /v1/me/subscription', operations.subscription, MY_SUBSCRIPTION_RESPONSES],
      ['POST /v1/me/subscription/changes', operations.change, SUBSCRIPTION_CHANGE_RESPONSES],
    ];
  for (const [name, operation, responses] of simulated) {
    for (const [key, response] of Object.entries(responses)) {
      it(`${name}: la respuesta simulada "${key}" (${response.status}) cumple el contrato`, () => {
        expect(
          validateAgainstSchema(
            contract,
            responseSchema(operation, response.status),
            response.body,
          ),
        ).toEqual([]);
        if (response.status >= 400) {
          expect(declaredCodes(operation, [response.status])).toContain(
            (response.body as { code: string }).code,
          );
        }
      });
    }
  }
});

describe('Contrato bff-web: operación de HU007', () => {
  const statement = contract.paths[ACCOUNT_STATEMENT_PATH]['get'];

  it('usa el operationId del estado de cuenta y se autentica con Authorization', () => {
    expect(statement.operationId).toBe('account_statement_v1_me_account_statement_get');
    expect(headerNames(statement)).toEqual([['authorization', 'false']]);
  });

  it('pagina con limit y cursor opcionales', () => {
    const query = (statement.parameters ?? [])
      .filter((parameter) => parameter.in === 'query')
      .map((parameter) => [parameter.name, String(parameter.required ?? false)]);

    expect(query).toEqual([
      ['limit', 'false'],
      ['cursor', 'false'],
    ]);
    expect(SIMULATED_STATEMENT_PAGE_SIZE).toBeGreaterThanOrEqual(1);
    expect(SIMULATED_STATEMENT_PAGE_SIZE).toBeLessThanOrEqual(100);
  });

  it('la respuesta del cliente tiene exactamente las propiedades obligatorias del contrato', () => {
    const body: AccountStatementResponseDto = ACCOUNT_STATEMENT_RESPONSES.activePremium.body;
    const commitment: CommitmentItemDto = body.commitments[0];
    const movement: MovementItemDto = body.movements[0];

    expect(Object.keys(body).sort()).toEqual(requiredProperties('AccountStatementResponse'));
    expect(Object.keys(commitment).sort()).toEqual(requiredProperties('CommitmentItem'));
    expect(Object.keys(movement).sort()).toEqual(requiredProperties('MovementItem'));
  });

  it('los estados y tipos de movimiento coinciden con el contrato; los pagos no están integrados', () => {
    expect<string[]>([...STATEMENT_STATUSES]).toEqual(
      property('AccountStatementResponse', 'statement_status')['enum'] as string[],
    );
    expect<string[]>([...COMMITMENT_STATUSES]).toEqual(
      property('CommitmentItem', 'status')['enum'] as string[],
    );
    expect<string[]>([...MOVEMENT_TYPES]).toEqual(
      property('MovementItem', 'movement_type')['enum'] as string[],
    );
    expect(property('AccountStatementResponse', 'payments_status')['const']).toBe('NOT_INTEGRATED');
    expect(property('AccountStatementResponse', 'balance')['type']).toBe('null');
  });

  it('los códigos de error del cliente son los que declara el contrato', () => {
    expect<string[]>(Object.values(ACCOUNT_STATEMENT_ERROR_CODES).sort()).toEqual(
      declaredCodes(statement, [401, 403, 422, 503, 504]),
    );
  });

  for (const [key, response] of Object.entries(ACCOUNT_STATEMENT_RESPONSES)) {
    it(`GET /v1/me/account-statement: la respuesta simulada "${key}" (${response.status}) cumple el contrato`, () => {
      expect(
        validateAgainstSchema(contract, responseSchema(statement, response.status), response.body),
      ).toEqual([]);
      if (response.status >= 400) {
        expect(declaredCodes(statement, [response.status])).toContain(
          (response.body as { code: string }).code,
        );
      }
    });
  }
});

describe('BffWebAffiliationApi', () => {
  let api: BffWebAffiliationApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: APP_CONFIG,
          useValue: {
            environment: 'test',
            bffWebBaseUrl: 'http://bff.test/',
            registrationPoliciesVersion: null,
          },
        },
      ],
    });
    api = TestBed.inject(BffWebAffiliationApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('consulta el catálogo y la suscripción con el access token', () => {
    api.getPlans('token-sintetico').subscribe();
    api.getSubscription('token-sintetico').subscribe();

    for (const url of ['http://bff.test/v1/plans', 'http://bff.test/v1/me/subscription']) {
      const request = http.expectOne(url);
      expect(request.request.method).toBe('GET');
      expect(request.request.headers.get('Authorization')).toBe('Bearer token-sintetico');
      request.flush(
        url.endsWith('plans') ? PLANS_RESPONSES.free.body : MY_SUBSCRIPTION_RESPONSES.free.body,
      );
    }
  });

  it('cambia el plan con Idempotency-Key y expone Idempotent-Replayed', () => {
    let replayed: string | null | undefined;
    api
      .changeSubscription('token-sintetico', VALID_SUBSCRIPTION_CHANGE_REQUEST, 'clave-uuid')
      .subscribe((response) => (replayed = response.headers.get('Idempotent-Replayed')));

    const request = http.expectOne('http://bff.test/v1/me/subscription/changes');
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-sintetico');
    expect(request.request.headers.get('Idempotency-Key')).toBe('clave-uuid');
    expect(request.request.body).toEqual(VALID_SUBSCRIPTION_CHANGE_REQUEST);
    request.flush(SUBSCRIPTION_CHANGE_RESPONSES.changed.body, {
      headers: { 'Idempotent-Replayed': 'true' },
    });
    expect(replayed).toBe('true');
  });

  it('consulta el estado de cuenta con el access token, el límite y el cursor sin modificar', () => {
    api.getAccountStatement('token-sintetico', null, 20).subscribe();
    const first = http.expectOne((r) => r.url === 'http://bff.test/v1/me/account-statement');
    expect(first.request.method).toBe('GET');
    expect(first.request.headers.get('Authorization')).toBe('Bearer token-sintetico');
    expect(first.request.params.keys()).toEqual(['limit']);
    expect(first.request.params.get('limit')).toBe('20');
    first.flush(ACCOUNT_STATEMENT_RESPONSES.firstPage.body);

    const cursor = ACCOUNT_STATEMENT_RESPONSES.firstPage.body.next_cursor!;
    api.getAccountStatement('token-sintetico', cursor, 20).subscribe();
    const next = http.expectOne((r) => r.url === 'http://bff.test/v1/me/account-statement');
    expect(next.request.params.get('cursor')).toBe(cursor);
    next.flush(ACCOUNT_STATEMENT_RESPONSES.lastPage.body);
  });
});
