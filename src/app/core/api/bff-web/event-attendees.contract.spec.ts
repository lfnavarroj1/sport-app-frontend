import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import {
  ATTENDEES_EVENT,
  ATTENDEES_NEXT_CURSOR,
  EVENT_ATTENDEES_PATH,
  EVENT_ATTENDEES_RESPONSES,
} from '../../../../testing/bff-web/event-attendees.fixtures';
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
  ATTENDEE_STATUS_FILTERS,
  AttendeeItemDto,
  BffWebEventsApi,
  EVENT_ATTENDEES_ERROR_CODES,
  EVENT_ATTENDEES_LIMIT,
  EventAttendeesResponseDto,
} from './events.api';

const contract = contractJson as unknown as OpenApiDocument;
const schemas = contract.components.schemas as Record<string, Record<string, unknown>>;
const operation: OpenApiOperation = contract.paths[EVENT_ATTENDEES_PATH]['get'];

/** Códigos declarados: antes de los dos puntos (después van los motivos de `details`). */
function declaredCodes(statuses: number[]): string[] {
  return statuses
    .flatMap((status) => {
      const description = operation.responses[String(status)]?.description ?? '';
      const codes = description.split(':')[0];
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

function parameter(name: string) {
  return (operation.parameters ?? []).find((p) => p.name === name)!;
}

describe('Contrato bff-web: inscritos de un evento (HU022, ADR-039)', () => {
  it('usa la versión del contrato y el operationId', () => {
    expect(contract.info.version).toBe(BFF_WEB_CONTRACT_VERSION);
    expect(operation.operationId).toBe('event_attendees_v1_me_events__event_id__registrations_get');
  });

  it('se autentica con Authorization y admite status, limit y cursor', () => {
    expect(
      (operation.parameters ?? []).map((p) => [p.in, p.name.toLowerCase(), p.required ?? false]),
    ).toEqual([
      ['path', 'event_id', true],
      ['query', 'status', false],
      ['query', 'limit', false],
      ['query', 'cursor', false],
      ['header', 'authorization', false],
    ]);
  });

  it('el filtro y los límites del cliente son los que documenta el contrato', () => {
    const status = String(parameter('status').schema['description'] ?? '');
    for (const value of ATTENDEE_STATUS_FILTERS) {
      expect(status).toContain(`\`${value}\``);
    }
    expect(status).toContain('`REGISTERED` (por defecto)');
    expect(parameter('limit').schema['description']).toContain(
      `${EVENT_ATTENDEES_LIMIT.min} a ${EVENT_ATTENDEES_LIMIT.max}; por defecto ${EVENT_ATTENDEES_LIMIT.default}`,
    );
  });

  it('las respuestas del cliente tienen exactamente las propiedades obligatorias del contrato', () => {
    const page: EventAttendeesResponseDto = EVENT_ATTENDEES_RESPONSES.firstPage.body;
    const item: AttendeeItemDto = page.items[0];

    expect(Object.keys(page).sort()).toEqual(requiredProperties('EventAttendeesResponse'));
    expect(Object.keys(item).sort()).toEqual(requiredProperties('AttendeeItem'));
    expect(Object.keys(item.applied_fee!).sort()).toEqual(requiredProperties('AppliedFee'));
    expect(Object.keys(page.sources[0]).sort()).toEqual(requiredProperties('AttendeesSource'));
  });

  it('la identidad es mínima: el contrato no publica correo ni perfil del inscrito', () => {
    const fields = Object.keys(schemas['AttendeeItem']['properties'] as object);

    expect(fields).not.toContain('email');
    expect(fields.filter((field) => /mail|phone|profile|health/.test(field))).toEqual([]);
    expect(property('AttendeesSource', 'status')['enum']).toEqual(['OK', 'UNAVAILABLE']);
  });

  it('los códigos de error del cliente son los que declara el contrato', () => {
    expect<string[]>(Object.values(EVENT_ATTENDEES_ERROR_CODES).sort()).toEqual(
      declaredCodes([401, 403, 404, 422, 503, 504]),
    );
    expect(operation.responses['422'].description).toContain('`invalid_cursor`');
  });

  for (const [name, response] of Object.entries(EVENT_ATTENDEES_RESPONSES)) {
    it(`la respuesta simulada "${name}" (${response.status}) cumple el contrato`, () => {
      expect(
        validateAgainstSchema(contract, responseSchema(operation, response.status), response.body),
      ).toEqual([]);
      if (response.status >= 400) {
        expect(declaredCodes([response.status])).toContain(
          (response.body as { code: string }).code,
        );
      }
    });
  }
});

describe('BffWebEventsApi: inscritos (HU022)', () => {
  let api: BffWebEventsApi;
  let http: HttpTestingController;
  const url = `http://bff.test/v1/me/events/${ATTENDEES_EVENT.event_id}/registrations`;

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
            healthDataConsentVersion: null,
          },
        },
      ],
    });
    api = TestBed.inject(BffWebEventsApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('consulta con el token y sin parámetros vacíos', () => {
    api.getEventAttendees('token-sintetico', ATTENDEES_EVENT.event_id, {}).subscribe();

    const request = http.expectOne((r) => r.url === url);
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-sintetico');
    expect(request.request.params.keys()).toEqual([]);
    request.flush(EVENT_ATTENDEES_RESPONSES.firstPage.body);
  });

  it('envía el filtro, el tamaño y el cursor sin modificarlo', () => {
    const cursor = `${ATTENDEES_NEXT_CURSOR}+/=`;
    api
      .getEventAttendees('token-sintetico', ATTENDEES_EVENT.event_id, {
        status: 'ALL',
        limit: 20,
        cursor,
      })
      .subscribe();

    const request = http.expectOne((r) => r.url === url);
    expect(request.request.params.get('status')).toBe('ALL');
    expect(request.request.params.get('limit')).toBe('20');
    expect(request.request.params.get('cursor')).toBe(cursor);
    expect(request.request.urlWithParams).toContain(encodeURIComponent(cursor));
    request.flush(EVENT_ATTENDEES_RESPONSES.lastPage.body);
  });
});
