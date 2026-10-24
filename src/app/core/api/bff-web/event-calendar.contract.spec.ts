import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import {
  EVENT_CONFLICTS_PATH,
  EVENT_CONFLICTS_RESPONSES,
  OWN_DRAFT,
  PUBLISHED_EVENTS_PATH,
  PUBLISHED_EVENTS_RESPONSES,
  SIMULATED_CALENDAR_CURSOR,
} from '../../../../testing/bff-web/event-calendar.fixtures';
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
  CONFLICT_REASONS,
  EVENT_CONFLICTS_ERROR_CODES,
  EventConflictDto,
  EventConflictsResponseDto,
  PUBLISHED_EVENTS_ERROR_CODES,
  PUBLISHED_EVENTS_ISSUES,
  PUBLISHED_EVENTS_LIMIT,
  PublishedEventItemDto,
  PublishedEventsResponseDto,
} from './events.api';

const contract = contractJson as unknown as OpenApiDocument;
const schemas = contract.components.schemas as Record<string, Record<string, unknown>>;

const operations = {
  calendar: contract.paths[PUBLISHED_EVENTS_PATH]['get'],
  conflicts: contract.paths[EVENT_CONFLICTS_PATH]['get'],
} satisfies Record<string, OpenApiOperation>;

/**
 * Códigos de error declarados. El `422` del calendario cita después de los dos
 * puntos los motivos de `details[].issue`, que no son códigos.
 */
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

function parameters(operation: OpenApiOperation, location: string) {
  return (operation.parameters ?? []).filter((parameter) => parameter.in === location);
}

describe('Contrato bff-web: operaciones de HU023', () => {
  it('usa la versión del contrato y sus operationId', () => {
    expect(contract.info.version).toBe(BFF_WEB_CONTRACT_VERSION);
    expect(operations.calendar.operationId).toBe('calendar_v1_events_get');
    expect(operations.conflicts.operationId).toBe(
      'conflicts_v1_me_events__event_id__conflicts_get',
    );
  });

  it('ambas se autentican con Authorization; el calendario admite periodo, filtros y cursor', () => {
    for (const operation of Object.values(operations)) {
      expect(parameters(operation, 'header').map((p) => p.name.toLowerCase())).toEqual([
        'authorization',
      ]);
    }
    const query = parameters(operations.calendar, 'query');
    expect(query.map((p) => [p.name, p.required ?? false])).toEqual([
      ['from', true],
      ['to', true],
      ['discipline', false],
      ['city', false],
      ['limit', false],
      ['cursor', false],
    ]);
    const limit = query.find((p) => p.name === 'limit')!.schema;
    expect<Record<string, unknown>>(PUBLISHED_EVENTS_LIMIT).toEqual({
      min: limit['minimum'],
      max: limit['maximum'],
      default: limit['default'],
    });
    expect(parameters(operations.conflicts, 'path').map((p) => p.schema['format'])).toEqual([
      'uuid',
    ]);
  });

  it('las respuestas del cliente tienen exactamente las propiedades obligatorias del contrato', () => {
    const page: PublishedEventsResponseDto = PUBLISHED_EVENTS_RESPONSES.march.body;
    const item: PublishedEventItemDto = page.items[0];
    const conflicts: EventConflictsResponseDto = EVENT_CONFLICTS_RESPONSES.found.body;
    const conflict: EventConflictDto = conflicts.conflicts[0];

    expect(Object.keys(page).sort()).toEqual(requiredProperties('PublishedEventsResponse'));
    expect(Object.keys(item).sort()).toEqual(requiredProperties('PublishedEventItem'));
    expect(Object.keys(item.location).sort()).toEqual(requiredProperties('PublishedEventLocation'));
    expect(Object.keys(item)).not.toContain('organizer_id');
    expect(Object.keys(conflicts).sort()).toEqual(requiredProperties('EventConflictsResponse'));
    expect(Object.keys(conflict).sort()).toEqual(requiredProperties('EventConflict'));
  });

  it('los motivos de coincidencia y de validación son los del contrato', () => {
    const reasons = (
      schemas['EventConflict']['properties'] as Record<string, Record<string, unknown>>
    )['reasons']['items'] as Record<string, unknown>;
    const description = operations.calendar.responses['422'].description;
    const issues = [...description.split(':')[1].matchAll(/`([a-z_]+)`/g)].map((m) => m[1]);

    expect<string[]>([...CONFLICT_REASONS]).toEqual(reasons['enum'] as string[]);
    expect<string[]>([...PUBLISHED_EVENTS_ISSUES]).toEqual(issues);
  });

  it('los códigos de error del cliente son los que declara el contrato', () => {
    expect<string[]>(Object.values(PUBLISHED_EVENTS_ERROR_CODES).sort()).toEqual(
      declaredCodes(operations.calendar, [401, 403, 422, 503, 504]),
    );
    expect<string[]>(Object.values(EVENT_CONFLICTS_ERROR_CODES).sort()).toEqual(
      declaredCodes(operations.conflicts, [401, 403, 404, 503, 504]),
    );
  });

  const simulated: [string, OpenApiOperation, Record<string, { status: number; body: unknown }>][] =
    [
      ['GET /v1/events', operations.calendar, PUBLISHED_EVENTS_RESPONSES],
      ['GET /v1/me/events/{event_id}/conflicts', operations.conflicts, EVENT_CONFLICTS_RESPONSES],
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

describe('BffWebEventsApi (HU023)', () => {
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

  it('consulta el calendario con el periodo y omite los filtros vacíos', () => {
    api
      .getPublishedEvents('token-sintetico', {
        from: '2027-03-01T05:00:00Z',
        to: '2027-04-01T05:00:00Z',
        discipline: '',
        city: null,
        limit: 200,
      })
      .subscribe();

    const request = http.expectOne((r) => r.url === 'http://bff.test/v1/events');
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-sintetico');
    expect(request.request.params.keys()).toEqual(['from', 'to', 'limit']);
    expect(request.request.urlWithParams).toBe(
      'http://bff.test/v1/events?from=2027-03-01T05%3A00%3A00Z&to=2027-04-01T05%3A00%3A00Z&limit=200',
    );
    request.flush(PUBLISHED_EVENTS_RESPONSES.march.body);
  });

  it('reenvía los filtros y el cursor sin alterarlos', () => {
    api
      .getPublishedEvents('token-sintetico', {
        from: '2027-03-01T05:00:00Z',
        to: '2027-04-01T05:00:00Z',
        discipline: 'Running',
        city: 'Bogotá',
        cursor: SIMULATED_CALENDAR_CURSOR,
      })
      .subscribe();

    const request = http.expectOne((r) => r.url === 'http://bff.test/v1/events');
    expect(request.request.params.get('discipline')).toBe('Running');
    expect(request.request.params.get('city')).toBe('Bogotá');
    expect(request.request.urlWithParams).toContain(
      `cursor=${encodeURIComponent(SIMULATED_CALENDAR_CURSOR)}`,
    );
    request.flush(PUBLISHED_EVENTS_RESPONSES.lastPage.body);
  });

  it('consulta las coincidencias del evento propio', () => {
    api.getEventConflicts('token-sintetico', OWN_DRAFT.event_id).subscribe();

    const request = http.expectOne(`http://bff.test/v1/me/events/${OWN_DRAFT.event_id}/conflicts`);
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-sintetico');
    request.flush(EVENT_CONFLICTS_RESPONSES.found.body);
  });
});
