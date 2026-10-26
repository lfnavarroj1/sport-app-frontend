import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import {
  ACCOUNT_PATH,
  ACCOUNT_READ,
  ACCOUNT_UPDATED,
  GET_ACCOUNT_RESPONSES,
  PUT_ACCOUNT_RESPONSES,
  VALID_ACCOUNT_REQUEST,
} from '../../../../testing/bff-web/account.fixtures';
import { SimulatedResponse } from '../../../../testing/bff-web/register-user.fixtures';
import {
  OpenApiDocument,
  OpenApiOperation,
  responseSchema,
  validateAgainstSchema,
} from '../../../../testing/openapi-schema';
import { APP_CONFIG, AppConfig } from '../../config/app-config';
import contractJson from '../contracts/bff-web.openapi.json';
import {
  ACCOUNT_ERROR_CODES,
  ACCOUNT_IDEMPOTENT_REPLAYED_HEADER,
  ACCOUNT_ISSUES,
  ACCOUNT_LIMITS,
  ACCOUNT_STATUSES,
  ACCOUNT_VERSION_CONFLICT_FIELD,
  AccountReadResponseDto,
  AccountResponseDto,
  AccountUpdateRequestDto,
  BffWebAccountApi,
} from './account.api';
import { ACTOR_TYPES, BFF_WEB_CONTRACT_VERSION } from './contract';

type Schema = Record<string, unknown> & {
  properties: Record<string, Record<string, unknown>>;
  required: string[];
};

const contract = contractJson as unknown as OpenApiDocument;
const getOperation: OpenApiOperation = contract.paths[ACCOUNT_PATH]['get'];
const putOperation: OpenApiOperation = contract.paths[ACCOUNT_PATH]['put'];
const schemas = contract.components.schemas as Record<string, Schema>;
const requestSchema = putOperation.requestBody!.content['application/json'].schema as Schema;

/** Códigos de error entre comillas invertidas de la descripción de una respuesta. */
function declaredCodes(operation: OpenApiOperation, status: number): string[] {
  const description = operation.responses[String(status)]?.description ?? '';
  return [...description.matchAll(/`([a-z_]+)`/g)].map((match) => match[1]);
}

function expectValidResponses(
  operation: OpenApiOperation,
  responses: Record<string, SimulatedResponse>,
): void {
  for (const [name, response] of Object.entries(responses)) {
    expect(
      validateAgainstSchema(contract, responseSchema(operation, response.status), response.body),
    )
      .withContext(`${name} (${response.status})`)
      .toEqual([]);
    if (response.status >= 400) {
      expect(declaredCodes(operation, response.status))
        .withContext(name)
        .toContain((response.body as { code: string }).code);
    }
  }
}

describe('Contrato bff-web: cuenta del usuario (HU002, ADR-035)', () => {
  it('usa la versión del contrato y los operationId de las dos operaciones', () => {
    expect(contract.info.version).toBe(BFF_WEB_CONTRACT_VERSION);
    expect(getOperation.operationId).toBe('get_account_v1_me_account_get');
    expect(putOperation.operationId).toBe('put_account_v1_me_account_put');
  });

  it('la consulta se autentica con Authorization y el comando acepta además Idempotency-Key', () => {
    const headers = (operation: OpenApiOperation) =>
      (operation.parameters ?? []).map((p) => [p.in, p.name.toLowerCase()]);

    expect(headers(getOperation)).toEqual([['header', 'authorization']]);
    expect(headers(putOperation)).toEqual([
      ['header', 'idempotency-key'],
      ['header', 'authorization'],
    ]);
    expect(Object.keys(putOperation.responses['200'].headers ?? {})).toContain(
      ACCOUNT_IDEMPOTENT_REPLAYED_HEADER,
    );
  });

  it('la solicitud del cliente cumple el esquema y rechaza user_id, actor_type, status y password', () => {
    const request: AccountUpdateRequestDto = VALID_ACCOUNT_REQUEST;

    expect(validateAgainstSchema(contract, requestSchema, request)).toEqual([]);
    expect([...requestSchema.required].sort()).toEqual(Object.keys(request).sort());
    expect(Object.keys(requestSchema.properties).sort()).toEqual(Object.keys(request).sort());
    for (const field of ['user_id', 'actor_type', 'status', 'password']) {
      expect(validateAgainstSchema(contract, requestSchema, { ...request, [field]: 'x' }))
        .withContext(field)
        .toEqual([`$.${field}: propiedad no permitida`]);
    }
  });

  it('los límites del cliente son los del esquema', () => {
    const { full_name, email, expected_version } = requestSchema.properties;

    expect(full_name['minLength']).toBe(ACCOUNT_LIMITS.fullNameMin);
    expect(full_name['maxLength']).toBe(ACCOUNT_LIMITS.fullNameMax);
    expect(email['maxLength']).toBe(ACCOUNT_LIMITS.emailMax);
    expect(email['format']).toBe('email');
    expect(expected_version['minimum']).toBe(1);
  });

  it('los modelos de transporte tienen exactamente las propiedades de los esquemas', () => {
    const read: AccountReadResponseDto = ACCOUNT_READ;
    const updated: AccountResponseDto = ACCOUNT_UPDATED;

    expect(Object.keys(schemas['AccountReadResponse'].properties).sort()).toEqual(
      Object.keys(read).sort(),
    );
    expect([...schemas['AccountReadResponse'].required].sort()).toEqual(Object.keys(read).sort());
    expect(Object.keys(schemas['AccountResponse'].properties).sort()).toEqual(
      Object.keys(updated).sort(),
    );
    expect([...schemas['AccountResponse'].required].sort()).toEqual(Object.keys(updated).sort());
    for (const name of ['AccountReadResponse', 'AccountResponse']) {
      expect(schemas[name].properties['actor_type']['enum']).toEqual([...ACTOR_TYPES]);
      expect(schemas[name].properties['status']['enum']).toEqual([...ACCOUNT_STATUSES]);
    }
  });

  it('declara los códigos de error que interpreta el cliente', () => {
    expect(declaredCodes(getOperation, 401)).toContain(ACCOUNT_ERROR_CODES.invalidAccessToken);
    expect(declaredCodes(getOperation, 404)).toContain(ACCOUNT_ERROR_CODES.userNotFound);
    expect(declaredCodes(putOperation, 409)).toEqual(
      jasmine.arrayContaining([
        ACCOUNT_ERROR_CODES.versionConflict,
        ACCOUNT_ERROR_CODES.emailAlreadyRegistered,
        ACCOUNT_ERROR_CODES.idempotencyKeyReused,
      ]),
    );
    expect(putOperation.responses['409'].description).toContain(
      `field: "${ACCOUNT_VERSION_CONFLICT_FIELD}"`,
    );
    expect(declaredCodes(putOperation, 422)).toEqual(
      jasmine.arrayContaining([ACCOUNT_ERROR_CODES.validationError, ...ACCOUNT_ISSUES]),
    );
    for (const operation of [getOperation, putOperation]) {
      expect(declaredCodes(operation, 503)).toContain(ACCOUNT_ERROR_CODES.upstreamUnavailable);
      expect(declaredCodes(operation, 504)).toContain(ACCOUNT_ERROR_CODES.upstreamTimeout);
    }
  });

  it('los motivos de los 422 simulados son los que declara el contrato', () => {
    for (const response of [
      PUT_ACCOUNT_RESPONSES.validationError,
      PUT_ACCOUNT_RESPONSES.fieldNotAllowed,
    ]) {
      for (const detail of response.body.details) {
        expect<readonly string[]>(ACCOUNT_ISSUES).toContain(detail.issue);
      }
    }
  });

  it('las respuestas simuladas de la consulta cumplen el contrato', () => {
    expectValidResponses(getOperation, GET_ACCOUNT_RESPONSES);
  });

  it('las respuestas simuladas del comando cumplen el contrato', () => {
    expectValidResponses(putOperation, PUT_ACCOUNT_RESPONSES);
  });
});

describe('BffWebAccountApi', () => {
  let api: BffWebAccountApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: APP_CONFIG,
          useValue: {
            environment: 'local',
            bffWebBaseUrl: 'http://bff.test/',
            registrationPoliciesVersion: null,
            healthDataConsentVersion: null,
          } satisfies AppConfig,
        },
      ],
    });
    api = TestBed.inject(BffWebAccountApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('consulta la cuenta con el token', () => {
    let account: AccountReadResponseDto | null = null;
    api.getAccount('token-sintetico').subscribe((response) => (account = response));

    const request = http.expectOne('http://bff.test/v1/me/account');
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-sintetico');
    request.flush(ACCOUNT_READ);
    expect(account!).toEqual(ACCOUNT_READ);
  });

  it('edita la cuenta con token, Idempotency-Key y la respuesta completa', () => {
    let replayed: string | null = null;
    api
      .putAccount('token-sintetico', VALID_ACCOUNT_REQUEST, 'clave-uuid')
      .subscribe((response) => (replayed = response.headers.get('Idempotent-Replayed')));

    const request = http.expectOne('http://bff.test/v1/me/account');
    expect(request.request.method).toBe('PUT');
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-sintetico');
    expect(request.request.headers.get('Idempotency-Key')).toBe('clave-uuid');
    expect(request.request.body).toEqual(VALID_ACCOUNT_REQUEST);
    request.flush(ACCOUNT_UPDATED, { headers: { 'Idempotent-Replayed': 'true' } });
    expect(replayed!).toBe('true');
  });
});
