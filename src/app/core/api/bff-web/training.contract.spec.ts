import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import {
  CREATE_TRAINING_PLAN_RESPONSES,
  GET_TRAINING_PLAN_RESPONSES,
  GRANT_AUTHORIZATION_RESPONSES,
  REVOKE_AUTHORIZATION_RESPONSES,
  SIMULATED_PLAN_ID,
  SIMULATED_PROFESSIONAL_ID,
  TRAINING_AUTHORIZATIONS_PATH,
  TRAINING_PLANS_PATH,
  VALID_CREATE_TRAINING_PLAN_REQUEST,
  VALID_GRANT_AUTHORIZATION_REQUEST,
} from '../../../../testing/bff-web/training.fixtures';
import {
  OpenApiDocument,
  OpenApiOperation,
  responseSchema,
  validateAgainstSchema,
} from '../../../../testing/openapi-schema';
import { APP_CONFIG } from '../../config/app-config';
import contractJson from '../contracts/bff-web.openapi.json';
import { BFF_WEB_CONTRACT_VERSION } from './contract';
import {
  BffWebTrainingApi,
  CREATE_TRAINING_PLAN_ERROR_CODES,
  CreateTrainingPlanRequestDto,
  GET_TRAINING_PLAN_ERROR_CODES,
  GRANT_AUTHORIZATION_ERROR_CODES,
  GrantAuthorizationRequestDto,
  IDEMPOTENT_REPLAYED_HEADER,
  REVOKE_AUTHORIZATION_ERROR_CODES,
  SPORTS,
  TRAINING_PLAN_LIMITS,
  TrainingAuthorizationResponseDto,
  TrainingPlanResponseDto,
} from './training.api';

const contract = contractJson as unknown as OpenApiDocument;
const schemas = contract.components.schemas as Record<string, Record<string, unknown>>;
const AUTHORIZATION_PATH = `${TRAINING_AUTHORIZATIONS_PATH}/{professional_id}`;
const PLAN_PATH = `${TRAINING_PLANS_PATH}/{plan_id}`;

const operations = {
  grant: contract.paths[TRAINING_AUTHORIZATIONS_PATH]['post'],
  revoke: contract.paths[AUTHORIZATION_PATH]['delete'],
  create: contract.paths[TRAINING_PLANS_PATH]['post'],
  get: contract.paths[PLAN_PATH]['get'],
} satisfies Record<string, OpenApiOperation>;

/**
 * Códigos de error declarados en la descripción de cada respuesta. El `422` de
 * crear un plan cita además el campo `details`, que no es un código.
 */
function declaredCodes(operation: OpenApiOperation, statuses: number[]): string[] {
  return statuses
    .flatMap((status) => {
      const description = operation.responses[String(status)]?.description ?? '';
      return [...description.matchAll(/`([a-z_]+)`/g)].map((match) => match[1]);
    })
    .filter((code) => code !== 'details')
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

describe('Contrato bff-web: operaciones de HU010', () => {
  it('usa la versión del contrato y sus operationId', () => {
    expect(contract.info.version).toBe(BFF_WEB_CONTRACT_VERSION);
    expect(operations.grant.operationId).toBe(
      'grant_authorization_v1_me_training_authorizations_post',
    );
    expect(operations.revoke.operationId).toBe(
      'revoke_authorization_v1_me_training_authorizations__professional_id__delete',
    );
    expect(operations.create.operationId).toBe('create_plan_v1_training_plans_post');
    expect(operations.get.operationId).toBe('get_plan_v1_training_plans__plan_id__get');
  });

  it('todas se autentican con Authorization; crear un plan exige Idempotency-Key UUID', () => {
    for (const operation of [operations.grant, operations.revoke, operations.get]) {
      expect(headerNames(operation)).toEqual([['authorization', 'false']]);
    }
    expect(headerNames(operations.create)).toEqual([
      ['idempotency-key', 'true'],
      ['authorization', 'false'],
    ]);
    const key = operations.create.parameters!.find((p) => p.name === 'Idempotency-Key');
    expect(key?.schema['format']).toBe('uuid');
    expect(Object.keys(operations.create.responses['201'].headers ?? {})).toContain(
      IDEMPOTENT_REPLAYED_HEADER,
    );
  });

  it('las solicitudes del cliente tienen exactamente las propiedades del contrato', () => {
    const grant: GrantAuthorizationRequestDto = VALID_GRANT_AUTHORIZATION_REQUEST;
    const create: CreateTrainingPlanRequestDto = VALID_CREATE_TRAINING_PLAN_REQUEST;

    expect(Object.keys(grant).sort()).toEqual(requiredProperties('GrantAuthorizationRequest'));
    expect(Object.keys(create).sort()).toEqual(requiredProperties('CreateTrainingPlanRequest'));
    expect(Object.keys(create.sessions[0]).sort()).toEqual(requiredProperties('PlannedSession'));
    expect(
      validateAgainstSchema(
        contract,
        operations.grant.requestBody!.content['application/json'].schema,
        grant,
      ),
    ).toEqual([]);
    expect(
      validateAgainstSchema(
        contract,
        operations.create.requestBody!.content['application/json'].schema,
        create,
      ),
    ).toEqual([]);
  });

  it('las respuestas del cliente tienen exactamente las propiedades obligatorias del contrato', () => {
    const authorization: TrainingAuthorizationResponseDto =
      GRANT_AUTHORIZATION_RESPONSES.granted.body;
    const plan: TrainingPlanResponseDto = CREATE_TRAINING_PLAN_RESPONSES.created.body;

    expect(Object.keys(authorization).sort()).toEqual(
      requiredProperties('TrainingAuthorizationResponse'),
    );
    expect(Object.keys(plan).sort()).toEqual(requiredProperties('TrainingPlanResponse'));
  });

  it('el catálogo de deportes y los límites coinciden con el contrato', () => {
    const session = (name: string) => property('PlannedSession', name);
    const request = (name: string) => property('CreateTrainingPlanRequest', name);
    const items = (name: string) => request(name)['items'] as Record<string, unknown>;

    expect<string[]>([...SPORTS]).toEqual(session('sport')['enum'] as string[]);
    expect<Record<string, unknown>>(TRAINING_PLAN_LIMITS).toEqual({
      emailMax: request('athlete_email')['maxLength'],
      titleMax: request('title')['maxLength'],
      objectivesMin: request('objectives')['minItems'],
      objectivesMax: request('objectives')['maxItems'],
      objectiveMax: items('objectives')['maxLength'],
      sessionsMin: request('sessions')['minItems'],
      sessionsMax: request('sessions')['maxItems'],
      durationMin: session('duration_minutes')['minimum'],
      durationMax: session('duration_minutes')['maximum'],
      intensityMin: session('intensity_rpe')['minimum'],
      intensityMax: session('intensity_rpe')['maximum'],
    });
  });

  it('los códigos de error del cliente son los que declara el contrato', () => {
    expect<string[]>(Object.values(GRANT_AUTHORIZATION_ERROR_CODES).sort()).toEqual(
      declaredCodes(operations.grant, [401, 403, 404, 422, 503, 504]),
    );
    expect<string[]>(Object.values(REVOKE_AUTHORIZATION_ERROR_CODES).sort()).toEqual(
      declaredCodes(operations.revoke, [401, 403, 503, 504]),
    );
    expect<string[]>(Object.values(CREATE_TRAINING_PLAN_ERROR_CODES).sort()).toEqual(
      declaredCodes(operations.create, [401, 403, 409, 422, 503, 504]),
    );
    expect<string[]>(Object.values(GET_TRAINING_PLAN_ERROR_CODES).sort()).toEqual(
      declaredCodes(operations.get, [401, 403, 404, 503, 504]),
    );
  });

  const simulated: [string, OpenApiOperation, Record<string, { status: number; body: unknown }>][] =
    [
      ['POST /v1/me/training-authorizations', operations.grant, GRANT_AUTHORIZATION_RESPONSES],
      [
        'DELETE /v1/me/training-authorizations/{professional_id}',
        operations.revoke,
        REVOKE_AUTHORIZATION_RESPONSES,
      ],
      ['POST /v1/training-plans', operations.create, CREATE_TRAINING_PLAN_RESPONSES],
      ['GET /v1/training-plans/{plan_id}', operations.get, GET_TRAINING_PLAN_RESPONSES],
    ];
  for (const [name, operation, responses] of simulated) {
    for (const [key, response] of Object.entries(responses)) {
      it(`${name}: la respuesta simulada "${key}" (${response.status}) cumple el contrato`, () => {
        if (response.status === 204) {
          expect(operation.responses['204'].content).toBeUndefined();
          expect(response.body).toBeNull();
          return;
        }
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

describe('BffWebTrainingApi', () => {
  let api: BffWebTrainingApi;
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
    api = TestBed.inject(BffWebTrainingApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('autoriza al profesional con el access token y conserva el estado HTTP', () => {
    let status = 0;
    api
      .grantAuthorization('token-sintetico', VALID_GRANT_AUTHORIZATION_REQUEST)
      .subscribe((response) => (status = response.status));

    const request = http.expectOne('http://bff.test/v1/me/training-authorizations');
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-sintetico');
    expect(request.request.body).toEqual(VALID_GRANT_AUTHORIZATION_REQUEST);
    request.flush(GRANT_AUTHORIZATION_RESPONSES.alreadyActive.body, {
      status: 200,
      statusText: 'OK',
    });
    expect(status).toBe(200);
  });

  it('revoca por identificador del profesional', () => {
    api.revokeAuthorization('token-sintetico', SIMULATED_PROFESSIONAL_ID).subscribe();

    const request = http.expectOne(
      `http://bff.test/v1/me/training-authorizations/${SIMULATED_PROFESSIONAL_ID}`,
    );
    expect(request.request.method).toBe('DELETE');
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-sintetico');
    request.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('crea el plan con Idempotency-Key y expone Idempotent-Replayed', () => {
    let replayed: string | null | undefined;
    api
      .createPlan('token-sintetico', VALID_CREATE_TRAINING_PLAN_REQUEST, 'clave-uuid')
      .subscribe((response) => (replayed = response.headers.get(IDEMPOTENT_REPLAYED_HEADER)));

    const request = http.expectOne('http://bff.test/v1/training-plans');
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-sintetico');
    expect(request.request.headers.get('Idempotency-Key')).toBe('clave-uuid');
    request.flush(CREATE_TRAINING_PLAN_RESPONSES.created.body, {
      status: 201,
      statusText: 'Created',
      headers: { [IDEMPOTENT_REPLAYED_HEADER]: 'true' },
    });
    expect(replayed).toBe('true');
  });

  it('consulta el plan por identificador', () => {
    api.getPlan('token-sintetico', SIMULATED_PLAN_ID).subscribe();

    const request = http.expectOne(`http://bff.test/v1/training-plans/${SIMULATED_PLAN_ID}`);
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-sintetico');
    request.flush(GET_TRAINING_PLAN_RESPONSES.found.body);
  });
});
