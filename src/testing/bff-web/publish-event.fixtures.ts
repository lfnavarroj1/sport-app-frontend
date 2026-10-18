/**
 * Simulador de HU024 derivado del contrato bff-web 0.16.0
 * (`src/app/core/api/contracts/bff-web.openapi.json`) y de los ejemplos de
 * ADR-033: `GET /v1/me/events`, `GET /v1/events/{event_id}` y
 * `POST /v1/events/{event_id}/publish`. Lo usan las pruebas unitarias y
 * Playwright; `publish-event.contract.spec.ts` valida cada respuesta contra el
 * esquema de su operación. Datos sintéticos.
 *
 * Archivo sin dependencias de Angular para poder importarlo desde Playwright.
 */
import { SIMULATED_EVENT_ID, SIMULATED_ORGANIZER_ID } from './create-event.fixtures';
import { SimulatedResponse } from './register-user.fixtures';

export const MY_EVENTS_PATH = '/v1/me/events';
export const SIMULATED_PUBLISH_EVENT_ID = SIMULATED_EVENT_ID;
const CORRELATION_ID = '6b8d0f2a-4c6e-4a8c-9e0b-2d4f6a8c0e2b';
const DAY_MS = 86_400_000;

type Status = 'DRAFT' | 'PUBLISHED';

/**
 * Evento sintético `index` del organizador (0 = el de ADR-033). Los borradores
 * empiezan en el futuro (marzo de 2027) en orden `starts_at` ascendente.
 */
export function organizerEvent(index: number, status: Status = 'DRAFT') {
  const starts = Date.UTC(2027, 2, 1, 12) + index * DAY_MS;
  const published = status === 'PUBLISHED';
  return {
    event_id:
      index === 0
        ? SIMULATED_PUBLISH_EVENT_ID
        : `9d1f3a5c-7e9b-4d1f-8a3c-${String(index).padStart(12, '0')}`,
    organizer_id: SIMULATED_ORGANIZER_ID,
    name: index === 0 ? 'Carrera 10K Bogotá' : `Evento sintético ${index + 1}`,
    description: 'Carrera recreativa de diez kilómetros para corredores aficionados.',
    discipline: 'Running',
    location: {
      name: 'Parque Metropolitano Simón Bolívar',
      address: 'Avenida Calle 63 # 60-50',
      city: 'Bogotá',
      country_code: 'CO',
    },
    starts_at: iso(starts),
    ends_at: iso(starts + 180 * 60_000),
    time_zone: 'America/Bogota',
    duration_minutes: 180,
    capacity: 5000,
    status,
    version: published ? 2 : 1,
    created_at: '2026-10-12T21:00:00Z',
    updated_at: published ? '2026-10-12T23:10:00Z' : '2026-10-12T21:00:00Z',
    published_at: published ? '2026-10-12T23:10:00Z' : null,
  };
}

/** Los primeros `count` eventos en el orden del contrato (`starts_at` asc). */
export function organizerEvents(count: number, status: Status = 'DRAFT', from = 0) {
  return Array.from({ length: count }, (_, index) => organizerEvent(from + index, status));
}

/** Detalle (`EventDetailResponse`) del evento: sin dirección, duración ni `published_at`. */
export function eventDetail(event: ReturnType<typeof organizerEvent>) {
  return {
    event_id: event.event_id,
    name: event.name,
    description: event.description,
    discipline: event.discipline,
    location: {
      name: event.location.name,
      city: event.location.city,
      country_code: event.location.country_code,
    },
    starts_at: event.starts_at,
    ends_at: event.ends_at,
    time_zone: event.time_zone,
    capacity: event.capacity,
    status: event.status,
    version: event.version,
    fee: null,
  };
}

/** Respuesta `200` de publicar: el agregado de ADR-033 con versión + 1 y `published_at`. */
export function publishedEvent(event: ReturnType<typeof organizerEvent>) {
  return {
    ...event,
    status: 'PUBLISHED' as const,
    version: event.version + 1,
    updated_at: '2026-10-18T15:00:00Z',
    published_at: '2026-10-18T15:00:00Z',
  };
}

function iso(epochMs: number): string {
  return new Date(epochMs).toISOString().replace('.000Z', 'Z');
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
const eventNotFound = error(404, 'event_not_found', 'El evento no existe.');
const upstreamUnavailable = error(503, 'upstream_unavailable', 'El servicio no está disponible.');
const upstreamTimeout = error(504, 'upstream_timeout', 'El servicio tardó demasiado en responder.');

export const MY_EVENTS_RESPONSES = {
  empty: { status: 200, body: { items: [], next_cursor: null } },
  firstPage: {
    status: 200,
    body: { items: organizerEvents(2), next_cursor: 'cursor-sintetico-eventos-2' },
  },
  lastPage: { status: 200, body: { items: organizerEvents(1, 'DRAFT', 2), next_cursor: null } },
  published: {
    status: 200,
    body: { items: organizerEvents(1, 'PUBLISHED', 5), next_cursor: null },
  },
  invalidAccessToken,
  permissionRequired,
  validationError: error(422, 'validation_error', 'Los parámetros no son válidos.', [
    { field: 'query.status', issue: 'unknown_value' },
  ]),
  upstreamUnavailable,
  upstreamTimeout,
} as const satisfies Record<string, SimulatedResponse>;

export const EVENT_DETAIL_RESPONSES = {
  draft: { status: 200, body: eventDetail(organizerEvent(0)) },
  published: { status: 200, body: eventDetail(organizerEvent(5, 'PUBLISHED')) },
  invalidAccessToken,
  permissionRequired,
  eventNotFound,
  upstreamUnavailable,
  upstreamTimeout,
} as const satisfies Record<string, SimulatedResponse>;

export const PUBLISH_EVENT_RESPONSES = {
  /** CA1: `DRAFT` → `PUBLISHED`, versión + 1 y `published_at`. */
  published: { status: 200, body: publishedEvent(organizerEvent(0)) },
  invalidAccessToken,
  permissionRequired,
  eventNotFound,
  idempotencyKeyReused: error(409, 'idempotency_key_reused', 'La clave ya se usó con otro evento.'),
  /** CA2: ejemplo de ADR-033, el inicio ya pasó. */
  notInFuture: error(
    422,
    'validation_error',
    'El evento no cumple los requisitos de publicación.',
    [{ field: 'starts_at', issue: 'not_in_future' }],
  ),
  /** CA2: varias reglas de ADR-028 incumplidas sobre el agregado persistido. */
  requirementsMissing: error(
    422,
    'validation_error',
    'El evento no cumple los requisitos de publicación.',
    [
      { field: 'description', issue: 'invalid_length' },
      { field: 'location.city', issue: 'required' },
    ],
  ),
  upstreamUnavailable,
  upstreamTimeout,
} as const satisfies Record<string, SimulatedResponse>;

export const SIMULATED_PUBLISH_CORRELATION_ID = CORRELATION_ID;
