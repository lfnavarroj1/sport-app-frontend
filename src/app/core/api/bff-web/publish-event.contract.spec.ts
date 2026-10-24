import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import {
  EVENT_DETAIL_RESPONSES,
  MY_EVENTS_PATH,
  MY_EVENTS_RESPONSES,
  PUBLISH_EVENT_RESPONSES,
  SIMULATED_PUBLISH_EVENT_ID,
} from '../../../../testing/bff-web/publish-event.fixtures';
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
  EVENT_DETAIL_ERROR_CODES,
  EVENT_IDEMPOTENT_REPLAYED_HEADER,
  EventAggregateResponseDto,
  EventDetailResponseDto,
  MY_EVENTS_ERROR_CODES,
  MY_EVENTS_LIMIT,
  MyEventsResponseDto,
  PUBLISH_EVENT_ERROR_CODES,
} from './events.api';

const contract = contractJson as unknown as OpenApiDocument;
const schemas = contract.components.schemas as Record<string, Record<string, unknown>>;
const operations = {
  mine: contract.paths[MY_EVENTS_PATH]['get'],
  detail: contract.paths['/v1/events/{event_id}']['get'],
  publish: contract.paths['/v1/events/{event_id}/publish']['post'],
} satisfies Record<string, OpenApiOperation>;

/**
 * Código declarado en cada respuesta: la descripción empieza por él; lo que sigue
 * cita parámetros, campos o motivos (`status`, `starts_at`, `not_in_future`…).
 */
function declaredCodes(operation: OpenApiOperation, statuses: number[]): string[] {
  return statuses
    .map((status) => /^`([a-z_]+)`/.exec(operation.responses[String(status)]?.description ?? ''))
    .filter((match) => match !== null)
    .map((match) => match[1])
    .sort();
}

function parameterNames(operation: OpenApiOperation): string[] {
  return (operation.parameters ?? []).map((item) => `${item.in}:${item.name.toLowerCase()}`);
}

function required(schema: string): string[] {
  return [...(schemas[schema]['required'] as string[])].sort();
}

describe('Contrato bff-web: operaciones de HU024 (ADR-033)', () => {
  it('usa la versión del contrato y sus operationId', () => {
    expect(contract.info.version).toBe(BFF_WEB_CONTRACT_VERSION);
    expect(operations.mine.operationId).toBe('my_events_v1_me_events_get');
    expect(operations.detail.operationId).toBe('event_detail_v1_events__event_id__get');
    expect(operations.publish.operationId).toBe('publish_v1_events__event_id__publish_post');
  });

  it('acepta exactamente los parámetros y cabeceras del contrato; publicar va sin cuerpo', () => {
    expect(parameterNames(operations.mine)).toEqual([
      'query:status',
      'query:limit',
      'query:cursor',
      'header:authorization',
    ]);
    expect(parameterNames(operations.detail)).toEqual(['path:event_id', 'header:authorization']);
    expect(parameterNames(operations.publish)).toEqual([
      'path:event_id',
      'header:idempotency-key',
      'header:authorization',
    ]);
    expect(operations.publish.requestBody).toBeUndefined();
  });

  it('el filtro de estado y el límite coinciden con el contrato', () => {
    const parameter = (name: string) =>
      operations.mine.parameters!.find((item) => item.name === name)!.schema;
    const status = (parameter('status')['anyOf'] as { enum?: string[] }[])[0];
    const limit = parameter('limit');

    expect(status.enum).toEqual(['DRAFT', 'PUBLISHED']);
    expect<Record<string, unknown>>(MY_EVENTS_LIMIT).toEqual({
      min: limit['minimum'],
      max: limit['maximum'],
      default: limit['default'],
    });
  });

  it('los modelos tienen exactamente las propiedades obligatorias del contrato', () => {
    const page: MyEventsResponseDto = MY_EVENTS_RESPONSES.firstPage.body;
    const aggregate: EventAggregateResponseDto = PUBLISH_EVENT_RESPONSES.published.body;
    const detail: EventDetailResponseDto = EVENT_DETAIL_RESPONSES.draft.body;

    expect(Object.keys(page).sort()).toEqual(required('MyEventsResponse'));
    expect(Object.keys(page.items[0]).sort()).toEqual(required('OwnEventResponse'));
    expect(Object.keys(aggregate).sort()).toEqual(required('EventAggregateResponse'));
    expect(Object.keys(detail).sort()).toEqual(required('EventDetailResponse'));
    expect(Object.keys(detail.location).sort()).toEqual(required('EventDetailLocation'));
  });

  it('publicar declara Idempotent-Replayed en el 200', () => {
    expect(Object.keys(operations.publish.responses['200'].headers ?? {})).toEqual([
      EVENT_IDEMPOTENT_REPLAYED_HEADER,
    ]);
  });

  it('los códigos de error del cliente son los que declara el contrato', () => {
    expect<string[]>(Object.values(MY_EVENTS_ERROR_CODES).sort()).toEqual(
      declaredCodes(operations.mine, [401, 403, 422, 503, 504]),
    );
    expect<string[]>(Object.values(EVENT_DETAIL_ERROR_CODES).sort()).toEqual(
      declaredCodes(operations.detail, [401, 403, 404, 503, 504]),
    );
    expect<string[]>(Object.values(PUBLISH_EVENT_ERROR_CODES).sort()).toEqual(
      declaredCodes(operations.publish, [401, 403, 404, 409, 422, 503, 504]),
    );
  });

  const cases: [string, OpenApiOperation, Record<string, { status: number; body: unknown }>][] = [
    ['GET /v1/me/events', operations.mine, MY_EVENTS_RESPONSES],
    ['GET /v1/events/{event_id}', operations.detail, EVENT_DETAIL_RESPONSES],
    ['POST /v1/events/{event_id}/publish', operations.publish, PUBLISH_EVENT_RESPONSES],
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
          expect(declaredCodes(operation, [response.status])).toContain(
            (response.body as { code: string }).code,
          );
        }
      });
    }
  }
});

describe('BffWebEventsApi (HU024)', () => {
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

  it('lista los eventos propios con estado, límite y el cursor opaco sin modificarlo', () => {
    api
      .getMyEvents('token-sintetico', { status: 'DRAFT', limit: 20, cursor: 'abc+/=' })
      .subscribe();

    const request = http.expectOne((r) => r.url === 'http://bff.test/v1/me/events');
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-sintetico');
    expect(request.request.params.keys().sort()).toEqual(['cursor', 'limit', 'status']);
    expect(request.request.urlWithParams).toContain('cursor=abc%2B%2F%3D');
    request.flush(MY_EVENTS_RESPONSES.lastPage.body);
  });

  it('consulta el detalle por event_id', () => {
    api.getEvent('token-sintetico', SIMULATED_PUBLISH_EVENT_ID).subscribe();

    const request = http.expectOne(`http://bff.test/v1/events/${SIMULATED_PUBLISH_EVENT_ID}`);
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-sintetico');
    request.flush(EVENT_DETAIL_RESPONSES.draft.body);
  });

  it('publica sin cuerpo, con token e Idempotency-Key', () => {
    api.publishEvent('token-sintetico', SIMULATED_PUBLISH_EVENT_ID, 'clave-1').subscribe();

    const request = http.expectOne(
      `http://bff.test/v1/events/${SIMULATED_PUBLISH_EVENT_ID}/publish`,
    );
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toBeNull();
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-sintetico');
    expect(request.request.headers.get('Idempotency-Key')).toBe('clave-1');
    request.flush(PUBLISH_EVENT_RESPONSES.published.body);
  });
});
