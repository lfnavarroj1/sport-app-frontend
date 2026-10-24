/**
 * Simulador de HU022 derivado del contrato bff-web 0.22.0
 * (`src/app/core/api/contracts/bff-web.openapi.json`) y de ADR-039:
 * `GET /v1/me/events/{event_id}/registrations`. Los eventos propios del
 * organizador (`GET /v1/me/events`) salen del simulador de HU024. Lo usan las
 * pruebas unitarias y Playwright; `event-attendees.contract.spec.ts` valida cada
 * respuesta contra el esquema de su operación. Datos sintéticos.
 *
 * Archivo sin dependencias de Angular para poder importarlo desde Playwright.
 */
import { organizerEvent } from './publish-event.fixtures';
import { SimulatedResponse } from './register-user.fixtures';

export const EVENT_ATTENDEES_PATH = '/v1/me/events/{event_id}/registrations';
const CORRELATION_ID = '8d0f2b4c-6e8a-4b0d-9f1a-3c5e7b9d1f2a';
const MINUTE_MS = 60_000;

/** Evento publicado del organizador con inscripciones (HU024 publicado, HU041 inscrito). */
export const ATTENDEES_EVENT = organizerEvent(5, 'PUBLISHED');
/** Borrador del organizador: sin inscripciones posibles (CA3). */
export const ATTENDEES_DRAFT = organizerEvent(0);

/** Ruta concreta de la consulta para un evento. */
export function eventAttendeesPath(eventId: string): string {
  return EVENT_ATTENDEES_PATH.replace('{event_id}', eventId);
}

function iso(epochMs: number): string {
  return new Date(epochMs).toISOString().replace('.000Z', 'Z');
}

/**
 * Inscripción sintética `index` en el orden del contrato (`registered_at`
 * ascendente). Cada tercera no tiene tarifa aplicada (evento sin tarifa, HU025).
 */
export function attendee(index: number, named = true) {
  const suffix = String(index + 1).padStart(12, '0');
  return {
    registration_id: `4e6a8c0d-2f4b-4d6e-8a0c-${suffix}`,
    athlete_id: `7a9c1e3f-5b7d-4f9a-8c1e-${suffix}`,
    display_name: named ? `Deportista sintético ${index + 1}` : null,
    status: 'REGISTERED' as const,
    registered_at: iso(Date.UTC(2026, 9, 20, 14) + index * 7 * MINUTE_MS),
    applied_fee: index % 3 === 2 ? null : { amount: '45000.00', currency: 'COP' },
  };
}

/** Las inscripciones `[from, from + count)` en el orden del contrato. */
export function attendees(count: number, from = 0, named = true) {
  return Array.from({ length: count }, (_, index) => attendee(from + index, named));
}

const NAMES_OK = [{ source: 'users' as const, status: 'OK' as const }];
const NAMES_UNAVAILABLE = [{ source: 'users' as const, status: 'UNAVAILABLE' as const }];

/** Respuesta `200` del contrato. `total` cuenta el filtro; `by_status`, todo el evento. */
export function attendeesPage(
  items: ReturnType<typeof attendee>[],
  total: number,
  nextCursor: string | null,
  namesAvailable = true,
  registered = total,
) {
  return {
    items,
    total,
    by_status: { REGISTERED: registered },
    next_cursor: nextCursor,
    sources: namesAvailable ? NAMES_OK : NAMES_UNAVAILABLE,
  };
}

/** 23 inscritos: la primera página trae 20 y la segunda, 3. */
export const ATTENDEES_TOTAL = 23;
export const ATTENDEES_NEXT_CURSOR = 'cursor-sintetico-inscritos-2';

function error(
  status: number,
  code: string,
  message: string,
  details: readonly { field: string | null; issue: string }[] = [],
) {
  return { status, body: { code, message, correlation_id: CORRELATION_ID, details } } as const;
}

export const EVENT_ATTENDEES_RESPONSES = {
  firstPage: {
    status: 200,
    body: attendeesPage(attendees(20), ATTENDEES_TOTAL, ATTENDEES_NEXT_CURSOR),
  },
  lastPage: { status: 200, body: attendeesPage(attendees(3, 20), ATTENDEES_TOTAL, null) },
  /** CA3: evento sin inscritos, `total` cero. */
  empty: { status: 200, body: attendeesPage([], 0, null) },
  /** CA6: Usuarios no respondió; los demás datos llegan completos. */
  namesUnavailable: {
    status: 200,
    body: attendeesPage(attendees(3, 0, false), 3, null, false),
  },
  invalidAccessToken: error(401, 'invalid_access_token', 'La sesión no es válida.'),
  permissionRequired: error(
    403,
    'permission_required',
    'No tienes permiso para consultar inscritos.',
  ),
  /** CA2: evento ajeno o inexistente, sin revelar participantes. */
  eventNotFound: error(404, 'event_not_found', 'El evento no existe.'),
  /** CA4: un cursor inválido responde `422`. */
  invalidCursor: error(422, 'validation_error', 'Los parámetros no son válidos.', [
    { field: 'query.cursor', issue: 'invalid_cursor' },
  ]),
  upstreamUnavailable: error(503, 'upstream_unavailable', 'El servicio no está disponible.'),
  upstreamTimeout: error(504, 'upstream_timeout', 'El servicio tardó demasiado en responder.'),
} as const satisfies Record<string, SimulatedResponse>;

export const SIMULATED_ATTENDEES_CORRELATION_ID = CORRELATION_ID;
