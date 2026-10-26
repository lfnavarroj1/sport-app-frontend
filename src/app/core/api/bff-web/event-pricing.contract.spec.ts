import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import {
  DELETE_EVENT_FEE_RESPONSES,
  EVENT_FEE_PATH,
  MY_PRICED_EVENTS_RESPONSES,
  PUBLISHED_WITH_REGISTRATIONS,
  PUT_EVENT_FEE_RESPONSES,
} from '../../../../testing/bff-web/event-pricing.fixtures';
import { MY_EVENTS_PATH } from '../../../../testing/bff-web/publish-event.fixtures';
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
  EVENT_FEE_AMOUNT_PATTERN,
  EVENT_FEE_CURRENCY,
  EVENT_FEE_ERROR_CODES,
  EVENT_FEE_ISSUES,
  EVENT_FEE_LIMITS,
  EVENT_IDEMPOTENT_REPLAYED_HEADER,
  EventFeeRequestDto,
  MyEventsResponseDto,
  OwnEventResponseDto,
} from './events.api';

const contract = contractJson as unknown as OpenApiDocument;
const schemas = contract.components.schemas as Record<string, Record<string, unknown>>;
const operations = {
  mine: contract.paths[MY_EVENTS_PATH]['get'],
  put: contract.paths[EVENT_FEE_PATH]['put'],
  delete: contract.paths[EVENT_FEE_PATH]['delete'],
} satisfies Record<string, OpenApiOperation>;
const requestSchema = operations.put.requestBody!.content['application/json'].schema as {
  properties: Record<string, Record<string, unknown>>;
  required: string[];
};

/** Códigos citados entre comillas invertidas en la descripción de la respuesta. */
function codesIn(operation: OpenApiOperation, status: number): string[] {
  const description = operation.responses[String(status)]?.description ?? '';
  return [...description.matchAll(/`([a-z_]+)`/g)].map((match) => match[1]);
}

function parameterNames(operation: OpenApiOperation): string[] {
  return (operation.parameters ?? []).map((item) => `${item.in}:${item.name.toLowerCase()}`);
}

function required(schema: string): string[] {
  return [...(schemas[schema]['required'] as string[])].sort();
}

describe('Contrato bff-web: tarifa del evento de HU025 (ADR-040)', () => {
  it('usa la versión del contrato y sus operationId', () => {
    expect(contract.info.version).toBe(BFF_WEB_CONTRACT_VERSION);
    expect(operations.put.operationId).toBe('put_fee_v1_events__event_id__fee_put');
    expect(operations.delete.operationId).toBe('delete_fee_v1_events__event_id__fee_delete');
  });

  it('PUT lleva Idempotency-Key y cuerpo; DELETE envía expected_version por la consulta', () => {
    expect(parameterNames(operations.put)).toEqual([
      'path:event_id',
      'header:idempotency-key',
      'header:authorization',
    ]);
    expect(parameterNames(operations.delete)).toEqual([
      'path:event_id',
      'query:expected_version',
      'header:idempotency-key',
      'header:authorization',
    ]);
    expect(operations.delete.requestBody).toBeUndefined();
    for (const operation of [operations.put, operations.delete]) {
      expect(Object.keys(operation.responses['200'].headers ?? {})).toEqual([
        EVENT_IDEMPOTENT_REPLAYED_HEADER,
      ]);
    }
  });

  it('el cuerpo del cliente tiene exactamente los campos de EventFeeRequest y cumple el esquema', () => {
    const body: EventFeeRequestDto = {
      amount: '85000.00',
      currency: EVENT_FEE_CURRENCY,
      expected_version: 2,
    };

    expect(Object.keys(body).sort()).toEqual([...requestSchema.required].sort());
    expect(Object.keys(requestSchema.properties).sort()).toEqual(
      [...requestSchema.required].sort(),
    );
    expect(validateAgainstSchema(contract, requestSchema, body)).toEqual([]);
    expect(
      validateAgainstSchema(contract, requestSchema, { ...body, amount: '85000' }),
    ).not.toEqual([]);
    expect(
      validateAgainstSchema(contract, requestSchema, { ...body, billing_unit: 'PER_PERSON' }),
    ).not.toEqual([]);
  });

  it('el patrón, los límites y la moneda del importe coinciden con el contrato', () => {
    const amount = requestSchema.properties['amount'];

    expect(new RegExp(amount['pattern'] as string).source).toBe(EVENT_FEE_AMOUNT_PATTERN.source);
    expect(amount['description']).toContain(EVENT_FEE_LIMITS.min);
    expect(amount['description']).toContain(EVENT_FEE_LIMITS.max);
    expect(EVENT_FEE_LIMITS.max.split('.')[0].length).toBe(EVENT_FEE_LIMITS.integerDigits);
    expect(requestSchema.properties['currency']['description']).toContain(EVENT_FEE_CURRENCY);
  });

  it('los modelos tienen exactamente las propiedades obligatorias del contrato', () => {
    const page: MyEventsResponseDto = MY_PRICED_EVENTS_RESPONSES.list.body;
    const event: OwnEventResponseDto = PUT_EVENT_FEE_RESPONSES.assigned.body;

    expect(Object.keys(page.items[0]).sort()).toEqual(required('OwnEventResponse'));
    expect(Object.keys(event).sort()).toEqual(required('OwnEventResponse'));
    expect(Object.keys(event.fee!).sort()).toEqual(required('EventFee'));
    expect(
      (schemas['OwnEventResponse']['properties'] as Record<string, unknown>)['registration_count'],
    ).toBeDefined();
  });

  it('los códigos de error y los motivos del 422 son los que declara el contrato', () => {
    const declared = [401, 403, 404, 409, 422, 503, 504].flatMap((status) => [
      ...codesIn(operations.put, status),
      ...codesIn(operations.delete, status),
    ]);
    for (const code of Object.values(EVENT_FEE_ERROR_CODES)) {
      expect(declared).toContain(code);
    }
    const issues = [...codesIn(operations.put, 422), ...codesIn(operations.delete, 422)];
    for (const issue of EVENT_FEE_ISSUES) {
      expect(issues).toContain(issue);
    }
  });

  const cases: [string, OpenApiOperation, Record<string, { status: number; body: unknown }>][] = [
    ['GET /v1/me/events', operations.mine, MY_PRICED_EVENTS_RESPONSES],
    ['PUT /v1/events/{event_id}/fee', operations.put, PUT_EVENT_FEE_RESPONSES],
    ['DELETE /v1/events/{event_id}/fee', operations.delete, DELETE_EVENT_FEE_RESPONSES],
  ];
  for (const [label, operation, responses] of cases) {
    for (const [name, response] of Object.entries(responses)) {
      it(`${label}: la respuesta simulada "${name}" (${response.status}) cumple el contrato`, () => {
        expect(
          validateAgainstSchema(
            contract,
            responseSchema(operation, response.status),
            response.body,
          ),
        ).toEqual([]);
        if (response.status >= 400) {
          expect(codesIn(operation, response.status)).toContain(
            (response.body as { code: string }).code,
          );
        }
      });
    }
  }
});

describe('BffWebEventsApi (HU025)', () => {
  const eventId = PUBLISHED_WITH_REGISTRATIONS.event_id;
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

  it('asigna la tarifa con PUT, token, Idempotency-Key y el cuerpo del contrato', () => {
    const body: EventFeeRequestDto = { amount: '90000.50', currency: 'COP', expected_version: 2 };
    api.putEventFee('token-sintetico', eventId, body, 'clave-1').subscribe();

    const request = http.expectOne(`http://bff.test/v1/events/${eventId}/fee`);
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual(body);
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-sintetico');
    expect(request.request.headers.get('Idempotency-Key')).toBe('clave-1');
    request.flush(PUT_EVENT_FEE_RESPONSES.assigned.body);
  });

  it('retira la tarifa con DELETE, sin cuerpo y con expected_version en la consulta', () => {
    api.deleteEventFee('token-sintetico', eventId, 2, 'clave-2').subscribe();

    const request = http.expectOne((r) => r.url === `http://bff.test/v1/events/${eventId}/fee`);
    expect(request.request.method).toBe('DELETE');
    expect(request.request.body).toBeNull();
    expect(request.request.params.keys()).toEqual(['expected_version']);
    expect(request.request.params.get('expected_version')).toBe('2');
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-sintetico');
    expect(request.request.headers.get('Idempotency-Key')).toBe('clave-2');
    request.flush(DELETE_EVENT_FEE_RESPONSES.removed.body);
  });
});
