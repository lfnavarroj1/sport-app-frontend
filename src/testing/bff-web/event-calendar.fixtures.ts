/**
 * Simulador de HU023 derivado del contrato bff-web 0.18.0
 * (`src/app/core/api/contracts/bff-web.openapi.json`; las operaciones son las de
 * 0.17.0, sin cambios) y de ADR-040: `GET /v1/events` (calendario de publicados)
 * y `GET /v1/me/events/{event_id}/conflicts`. Los eventos propios del organizador
 * (`GET /v1/me/events`) salen del simulador de HU024. Lo usan las pruebas
 * unitarias y Playwright; `event-calendar.contract.spec.ts` valida cada respuesta
 * contra el esquema de su operación. Datos sintéticos.
 *
 * Archivo sin dependencias de Angular para poder importarlo desde Playwright.
 */
import { organizerEvent } from './publish-event.fixtures';
import { SimulatedResponse } from './register-user.fixtures';

export const PUBLISHED_EVENTS_PATH = '/v1/events';
export const EVENT_CONFLICTS_PATH = '/v1/me/events/{event_id}/conflicts';
const CORRELATION_ID = '7c9e1a3b-5d7f-4a9c-8e1b-3d5f7a9c1e3b';
const HOUR_MS = 3_600_000;

/** Borrador propio del organizador: 1 de marzo de 2027, 07:00–10:00 en Bogotá (ADR-033). */
export const OWN_DRAFT = organizerEvent(0);

function iso(epochMs: number): string {
  return new Date(epochMs).toISOString().replace('.000Z', 'Z');
}

function published(
  id: string,
  name: string,
  discipline: string,
  city: string,
  startsAt: number,
  hours: number,
  timeZone = 'America/Bogota',
) {
  return {
    event_id: id,
    name,
    discipline,
    location: { name: `Sede de ${name}`, city, country_code: 'CO' },
    starts_at: iso(startsAt),
    ends_at: iso(startsAt + hours * HOUR_MS),
    time_zone: timeZone,
    status: 'PUBLISHED' as const,
    version: 2,
    fee: null as EventFeeFixture | null,
  };
}

/** Esquema `EventFee` (bff-web 0.26.0, HU025). */
export interface EventFeeFixture {
  readonly amount: string;
  readonly currency: string;
}

const MARCH_1 = Date.UTC(2027, 2, 1);

/**
 * Publicados de otros organizadores alrededor del borrador (12:00–15:00 UTC):
 * uno coincide por disciplina y ciudad, otro solo por ciudad, uno se solapa sin
 * compartir nada, uno solo toca el borde y otro cae dos semanas después.
 */
export const CALENDAR_EVENTS = {
  sameBoth: published(
    '1a2b3c4d-0001-4a1b-8c1d-000000000001',
    'Media maratón de Bogotá',
    'running',
    'Bogota',
    MARCH_1 + 11 * HOUR_MS,
    4,
  ),
  noMatch: published(
    '1a2b3c4d-0002-4a1b-8c1d-000000000002',
    'Gran Fondo Medellín',
    'Ciclismo',
    'Medellín',
    MARCH_1 + 13 * HOUR_MS,
    4,
  ),
  sameCity: published(
    '1a2b3c4d-0003-4a1b-8c1d-000000000003',
    'Triatlón de Bogotá',
    'Triatlón',
    'Bogotá',
    MARCH_1 + 14 * HOUR_MS,
    4,
  ),
  touchingEdge: published(
    '1a2b3c4d-0004-4a1b-8c1d-000000000004',
    'Carrera de la tarde',
    'Running',
    'Bogotá',
    MARCH_1 + 15 * HOUR_MS,
    2,
  ),
  later: published(
    '1a2b3c4d-0005-4a1b-8c1d-000000000005',
    'Carrera nocturna de Madrid',
    'Running',
    'Madrid',
    MARCH_1 + 14 * 24 * HOUR_MS + 19 * HOUR_MS,
    3,
    'Europe/Madrid',
  ),
} as const;

/** Publicados del mes de marzo de 2027, en el orden del contrato (`starts_at`, `event_id`). */
export const MARCH_EVENTS = [
  CALENDAR_EVENTS.sameBoth,
  CALENDAR_EVENTS.noMatch,
  CALENDAR_EVENTS.sameCity,
  CALENDAR_EVENTS.touchingEdge,
  CALENDAR_EVENTS.later,
] as const;

/** `count` publicados sintéticos, uno por hora desde el 2 de marzo de 2027, para paginar. */
export function calendarEvents(count: number, from = 0) {
  return Array.from({ length: count }, (_, offset) => {
    const index = from + offset;
    return published(
      `2b3c4d5e-${String(index).padStart(4, '0')}-4b2c-9d3e-${String(index).padStart(12, '0')}`,
      `Evento publicado ${index + 1}`,
      'Running',
      'Bogotá',
      MARCH_1 + 24 * HOUR_MS + index * HOUR_MS,
      1,
    );
  });
}

function conflict(
  event: (typeof MARCH_EVENTS)[number],
  reasons: readonly ('SAME_DISCIPLINE' | 'SAME_CITY')[],
) {
  return {
    event_id: event.event_id,
    name: event.name,
    discipline: event.discipline,
    city: event.location.city,
    starts_at: event.starts_at,
    ends_at: event.ends_at,
    time_zone: event.time_zone,
    reasons,
  };
}

function error(
  status: number,
  code: string,
  message: string,
  details: readonly { field: string | null; issue: string }[] = [],
) {
  return { status, body: { code, message, correlation_id: CORRELATION_ID, details } } as const;
}

const invalidAccessToken = error(401, 'invalid_access_token', 'La sesión no es válida.');
const permissionRequired = error(403, 'permission_required', 'No tiene permiso.');
const upstreamUnavailable = error(503, 'upstream_unavailable', 'El servicio no está disponible.');
const upstreamTimeout = error(504, 'upstream_timeout', 'El servicio tardó demasiado en responder.');

export const SIMULATED_CALENDAR_CURSOR = 'eyJzIjoiMjAyNy0wMy0wMlQwMDowMDowMFoifQ+/=';

export const PUBLISHED_EVENTS_RESPONSES = {
  march: { status: 200, body: { items: MARCH_EVENTS, next_cursor: null } },
  firstPage: {
    status: 200,
    body: { items: calendarEvents(2), next_cursor: SIMULATED_CALENDAR_CURSOR },
  },
  lastPage: { status: 200, body: { items: calendarEvents(1, 2), next_cursor: null } },
  empty: { status: 200, body: { items: [], next_cursor: null } },
  invalidAccessToken,
  permissionRequired,
  /** CA3: periodo de más de 92 días. */
  periodTooLong: error(422, 'validation_error', 'El periodo no es válido.', [
    { field: 'query.to', issue: 'out_of_range' },
  ]),
  /** CA3: filtro demasiado corto. */
  invalidFilter: error(422, 'validation_error', 'Los parámetros no son válidos.', [
    { field: 'query.city', issue: 'invalid_length' },
  ]),
  upstreamUnavailable,
  upstreamTimeout,
} as const satisfies Record<string, SimulatedResponse>;

export const EVENT_CONFLICTS_RESPONSES = {
  /** CA2: el borrador coincide con dos publicados; el del borde y el que no comparte nada no. */
  found: {
    status: 200,
    body: {
      conflicts: [
        conflict(CALENDAR_EVENTS.sameBoth, ['SAME_DISCIPLINE', 'SAME_CITY']),
        conflict(CALENDAR_EVENTS.sameCity, ['SAME_CITY']),
      ],
      evaluated_at: '2026-10-23T15:00:00Z',
    },
  },
  none: { status: 200, body: { conflicts: [], evaluated_at: '2026-10-23T15:00:00Z' } },
  invalidAccessToken,
  permissionRequired,
  /** CA2: evento ajeno o inexistente. */
  eventNotFound: error(404, 'event_not_found', 'El evento no existe.'),
  upstreamUnavailable,
  upstreamTimeout,
} as const satisfies Record<string, SimulatedResponse>;

export const SIMULATED_CALENDAR_CORRELATION_ID = CORRELATION_ID;
