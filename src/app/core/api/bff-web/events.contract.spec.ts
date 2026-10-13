import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import {
  CREATE_EVENT_PATH,
  CREATE_EVENT_RESPONSES,
  CREATED_EVENT,
  VALID_CREATE_EVENT_REQUEST,
} from '../../../../testing/bff-web/create-event.fixtures';
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
  BffWebEventsApi,
  COUNTRY_CODE_PATTERN,
  CREATE_EVENT_ERROR_CODES,
  CREATE_EVENT_LIMITS,
  CreateEventRequestDto,
  EVENT_IDEMPOTENT_REPLAYED_HEADER,
  EventResponseDto,
} from './events.api';

const contract = contractJson as unknown as OpenApiDocument;
const operation: OpenApiOperation = contract.paths[CREATE_EVENT_PATH]['post'];
const requestSchema = operation.requestBody!.content['application/json'].schema as {
  properties: Record<string, Record<string, unknown>>;
  required: string[];
};
const schemas = contract.components.schemas as Record<
  string,
  { properties: Record<string, Record<string, unknown>>; required: string[] }
>;

/**
 * Códigos de error declarados en la descripción de cada respuesta. La del `403`
 * cita además el actor `organizer`, que no es un código.
 */
function declaredCodes(status: number): string[] {
  const description = operation.responses[String(status)]?.description ?? '';
  return [...description.matchAll(/`([a-z_]+)`/g)]
    .map((match) => match[1])
    .filter((code) => code !== 'organizer');
}

describe('Contrato bff-web: POST /v1/events (HU021, ADR-028)', () => {
  it('usa la versión del contrato y su operationId', () => {
    expect(contract.info.version).toBe(BFF_WEB_CONTRACT_VERSION);
    expect(operation.operationId).toBe('create_v1_events_post');
  });

  it('se autentica con Authorization y acepta Idempotency-Key; 201 expone Location e Idempotent-Replayed', () => {
    expect((operation.parameters ?? []).map((p) => [p.in, p.name.toLowerCase()])).toEqual([
      ['header', 'idempotency-key'],
      ['header', 'authorization'],
    ]);
    expect(Object.keys(operation.responses['201'].headers ?? {}).sort()).toEqual(
      [EVENT_IDEMPOTENT_REPLAYED_HEADER, 'Location'].sort(),
    );
  });

  it('la solicitud del cliente tiene exactamente los campos de ADR-028 y cumple el esquema', () => {
    const request: CreateEventRequestDto = VALID_CREATE_EVENT_REQUEST;

    expect(Object.keys(request).sort()).toEqual([...requestSchema.required].sort());
    expect(Object.keys(requestSchema.properties).sort()).toEqual(
      [...requestSchema.required].sort(),
    );
    expect(Object.keys(request.location).sort()).toEqual(
      [...schemas['EventLocation'].required].sort(),
    );
    expect(validateAgainstSchema(contract, requestSchema, request)).toEqual([]);
    expect(
      validateAgainstSchema(contract, requestSchema, { ...request, organizer_id: 'x' }),
    ).toEqual(['$.organizer_id: propiedad no permitida']);
  });

  it('la respuesta del cliente tiene exactamente las propiedades obligatorias del contrato', () => {
    const response: EventResponseDto = CREATED_EVENT;

    expect(Object.keys(response).sort()).toEqual([...schemas['EventResponse'].required].sort());
  });

  it('los límites y el patrón de país coinciden con el contrato', () => {
    const body = requestSchema.properties;
    const location = schemas['EventLocation'].properties;

    expect<Record<string, unknown>>(CREATE_EVENT_LIMITS).toEqual({
      nameMin: body['name']['minLength'],
      nameMax: body['name']['maxLength'],
      descriptionMin: body['description']['minLength'],
      descriptionMax: body['description']['maxLength'],
      disciplineMin: body['discipline']['minLength'],
      disciplineMax: body['discipline']['maxLength'],
      locationNameMin: location['name']['minLength'],
      locationNameMax: location['name']['maxLength'],
      addressMin: location['address']['minLength'],
      addressMax: location['address']['maxLength'],
      cityMin: location['city']['minLength'],
      cityMax: location['city']['maxLength'],
      durationMin: body['duration_minutes']['minimum'],
      durationMax: body['duration_minutes']['maximum'],
      capacityMin: body['capacity']['minimum'],
      capacityMax: body['capacity']['maximum'],
    });
    expect(COUNTRY_CODE_PATTERN.source).toBe(location['country_code']['pattern'] as string);
  });

  it('los códigos de error del cliente son los que declara el contrato', () => {
    const declared = [401, 403, 409, 422, 503, 504].flatMap(declaredCodes).sort();

    expect<string[]>(Object.values(CREATE_EVENT_ERROR_CODES).sort()).toEqual(declared);
  });

  for (const [name, response] of Object.entries(CREATE_EVENT_RESPONSES)) {
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

describe('BffWebEventsApi', () => {
  let api: BffWebEventsApi;
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
    api = TestBed.inject(BffWebEventsApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('crea el borrador con token, Idempotency-Key y la respuesta completa', () => {
    let status = 0;
    api
      .createEvent('token-sintetico', VALID_CREATE_EVENT_REQUEST, 'clave-uuid')
      .subscribe((response) => (status = response.status));

    const request = http.expectOne('http://bff.test/v1/events');
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-sintetico');
    expect(request.request.headers.get('Idempotency-Key')).toBe('clave-uuid');
    expect(request.request.body).toEqual(VALID_CREATE_EVENT_REQUEST);
    request.flush(CREATED_EVENT, { status: 201, statusText: 'Created' });
    expect(status).toBe(201);
  });
});
