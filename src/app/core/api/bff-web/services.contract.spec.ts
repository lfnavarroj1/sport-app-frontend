import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import {
  CREATE_SERVICE_PATH,
  CREATE_SERVICE_RESPONSES,
  CREATED_SERVICE,
  VALID_CREATE_SERVICE_REQUEST,
} from '../../../../testing/bff-web/create-service.fixtures';
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
  BffWebServicesApi,
  CREATE_SERVICE_ERROR_CODES,
  CREATE_SERVICE_LIMITS,
  CreateServiceRequestDto,
  SERVICE_AMOUNT_PATTERN,
  SERVICE_CURRENCY,
  SERVICE_IDEMPOTENT_REPLAYED_HEADER,
  ServiceResponseDto,
} from './services.api';
import { BILLING_UNITS, SERVICE_CATEGORIES, SERVICE_MODALITIES } from './services-availability.api';

const contract = contractJson as unknown as OpenApiDocument;
const operation: OpenApiOperation = contract.paths[CREATE_SERVICE_PATH]['post'];
const requestSchema = operation.requestBody!.content['application/json'].schema as {
  properties: Record<string, Record<string, unknown>>;
  required: string[];
};
const schemas = contract.components.schemas as Record<
  string,
  { properties: Record<string, Record<string, unknown>>; required: string[] }
>;

/** Códigos de error declarados en la descripción de cada respuesta. */
function declaredCodes(status: number): string[] {
  const description = operation.responses[String(status)]?.description ?? '';
  return [...description.matchAll(/`([a-z_]+)`/g)]
    .map((match) => match[1])
    .filter((code) => !code.includes('.'));
}

/** Opciones `array` de `availability` en la solicitud (`anyOf` con `null`). */
function availabilityArraySchema(): Record<string, unknown> {
  const options = requestSchema.properties['availability']['anyOf'] as Record<string, unknown>[];
  return options.find((option) => option['type'] === 'array')!;
}

describe('Contrato bff-web: POST /v1/services (HU015, ADR-027)', () => {
  it('usa la versión del contrato y su operationId', () => {
    expect(contract.info.version).toBe(BFF_WEB_CONTRACT_VERSION);
    expect(operation.operationId).toBe('create_v1_services_post');
  });

  it('se autentica con Authorization y acepta Idempotency-Key; 201 expone Location e Idempotent-Replayed', () => {
    expect((operation.parameters ?? []).map((p) => [p.in, p.name.toLowerCase()])).toEqual([
      ['header', 'idempotency-key'],
      ['header', 'authorization'],
    ]);
    expect(Object.keys(operation.responses['201'].headers ?? {}).sort()).toEqual(
      [SERVICE_IDEMPOTENT_REPLAYED_HEADER, 'Location'].sort(),
    );
  });

  it('la solicitud del cliente cumple el esquema y no admite provider_id (CA3)', () => {
    const request: CreateServiceRequestDto = VALID_CREATE_SERVICE_REQUEST;

    expect(Object.keys(requestSchema.properties).sort()).toEqual(
      [...requestSchema.required, 'availability'].sort(),
    );
    expect(Object.keys(request.price).sort()).toEqual([...schemas['ServicePrice'].required].sort());
    expect(validateAgainstSchema(contract, requestSchema, request)).toEqual([]);
    expect(
      validateAgainstSchema(contract, requestSchema, {
        name: request.name,
        description: request.description,
        category: request.category,
        modality: request.modality,
        price: request.price,
      }),
    ).toEqual([]);
    expect(
      validateAgainstSchema(contract, requestSchema, { ...request, provider_id: 'x' }),
    ).toEqual(['$.provider_id: propiedad no permitida']);
  });

  it('la respuesta del cliente tiene exactamente las propiedades obligatorias del contrato', () => {
    const response: ServiceResponseDto = CREATED_SERVICE;

    expect(Object.keys(response).sort()).toEqual([...schemas['ServiceResponse'].required].sort());
  });

  it('los límites, el patrón del importe, la moneda y los catálogos coinciden con el contrato', () => {
    const body = requestSchema.properties;
    const interval = schemas['AvailabilityInterval'].properties;
    const price = schemas['ServicePrice'].properties;

    expect<Record<string, unknown>>(CREATE_SERVICE_LIMITS).toEqual({
      nameMin: body['name']['minLength'],
      nameMax: body['name']['maxLength'],
      descriptionMin: body['description']['minLength'],
      descriptionMax: body['description']['maxLength'],
      intervalsMax: availabilityArraySchema()['maxItems'],
      capacityMin: interval['capacity']['minimum'],
      capacityMax: interval['capacity']['maximum'],
    });
    expect(SERVICE_AMOUNT_PATTERN.source).toBe(price['amount']['pattern'] as string);
    expect(price['currency']['const']).toBe(SERVICE_CURRENCY);
    expect<readonly string[]>(SERVICE_CATEGORIES).toEqual(body['category']['enum'] as string[]);
    expect<readonly string[]>(SERVICE_MODALITIES).toEqual(body['modality']['enum'] as string[]);
    expect<readonly string[]>(BILLING_UNITS).toEqual(price['billing_unit']['enum'] as string[]);
  });

  it('el importe se transporta como cadena: cero y el máximo son válidos; tres decimales no', () => {
    expect(SERVICE_AMOUNT_PATTERN.test('0')).toBeTrue();
    expect(SERVICE_AMOUNT_PATTERN.test('0.00')).toBeTrue();
    expect(SERVICE_AMOUNT_PATTERN.test('999999999.99')).toBeTrue();
    expect(SERVICE_AMOUNT_PATTERN.test('1000000000')).toBeFalse();
    expect(SERVICE_AMOUNT_PATTERN.test('10.123')).toBeFalse();
    expect(SERVICE_AMOUNT_PATTERN.test('10,50')).toBeFalse();
  });

  it('los códigos de error del cliente son los que declara el contrato', () => {
    const declared = [401, 403, 409, 422, 503, 504].flatMap(declaredCodes).sort();

    expect<string[]>(Object.values(CREATE_SERVICE_ERROR_CODES).sort()).toEqual(declared);
  });

  for (const [name, response] of Object.entries(CREATE_SERVICE_RESPONSES)) {
    it(`la respuesta simulada "${name}" (${response.status}) cumple el contrato`, () => {
      expect(
        validateAgainstSchema(contract, responseSchema(operation, response.status), response.body),
      ).toEqual([]);
      if (response.status >= 400) {
        expect(declaredCodes(response.status)).toContain((response.body as { code: string }).code);
      }
    });
  }
});

describe('BffWebServicesApi', () => {
  let api: BffWebServicesApi;
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
    api = TestBed.inject(BffWebServicesApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('crea el borrador con token, Idempotency-Key y la respuesta completa', () => {
    let status = 0;
    api
      .createService('token-sintetico', VALID_CREATE_SERVICE_REQUEST, 'clave-uuid')
      .subscribe((response) => (status = response.status));

    const request = http.expectOne('http://bff.test/v1/services');
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-sintetico');
    expect(request.request.headers.get('Idempotency-Key')).toBe('clave-uuid');
    expect(request.request.body).toEqual(VALID_CREATE_SERVICE_REQUEST);
    request.flush(CREATED_SERVICE, { status: 201, statusText: 'Created' });
    expect(status).toBe(201);
  });
});
