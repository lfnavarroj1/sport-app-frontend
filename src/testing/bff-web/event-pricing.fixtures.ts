/**
 * Simulador de HU025 derivado del contrato bff-web 0.26.0
 * (`src/app/core/api/contracts/bff-web.openapi.json`) y de ADR-040:
 * `GET /v1/me/events` con la tarifa y `registration_count`, y
 * `PUT`/`DELETE /v1/events/{event_id}/fee`. Lo usan las pruebas unitarias y
 * Playwright; `event-pricing.contract.spec.ts` valida cada respuesta contra el
 * esquema de su operación. Datos sintéticos.
 *
 * Archivo sin dependencias de Angular para poder importarlo desde Playwright.
 */
import { organizerEvent } from './publish-event.fixtures';
import { SimulatedResponse } from './register-user.fixtures';

export const EVENT_FEE_PATH = '/v1/events/{event_id}/fee';
const CORRELATION_ID = '3e5a7c9b-1d3f-4b5d-8f7a-9c1e3a5b7d9f';
const FEE_UPDATED_AT = '2026-10-24T15:00:00Z';

type OwnEvent = ReturnType<typeof organizerEvent>;

/** Evento propio con la tarifa y las inscripciones indicadas. */
export function pricedEvent(
  event: OwnEvent,
  amount: string | null,
  registrationCount = 0,
): OwnEvent {
  return {
    ...event,
    fee: amount === null ? null : { amount, currency: 'COP' },
    fee_updated_at: amount === null ? null : '2026-10-20T15:00:00Z',
    registration_count: registrationCount,
  };
}

/**
 * Respuesta `200` del comando (`OwnEventResponse`): la tarifa nueva (o `null`
 * al retirarla), versión + 1 y las inscripciones sin cambios (CA1, CA4).
 */
export function feeChanged(event: OwnEvent, amount: string | null): OwnEvent {
  return {
    ...event,
    version: event.version + 1,
    updated_at: FEE_UPDATED_AT,
    fee: amount === null ? null : { amount, currency: 'COP' },
    fee_updated_at: FEE_UPDATED_AT,
  };
}

/** Borrador sin tarifa ni inscritos (versión 1). */
export const DRAFT_WITHOUT_FEE = pricedEvent(organizerEvent(0), null);
/** Publicado con tarifa `85000.00` y tres inscritos (versión 2). */
export const PUBLISHED_WITH_REGISTRATIONS = pricedEvent(
  organizerEvent(1, 'PUBLISHED'),
  '85000.00',
  3,
);
/** Publicado gratuito (`0.00`), sin inscritos. */
export const PUBLISHED_FREE = pricedEvent(organizerEvent(2, 'PUBLISHED'), '0.00');

function error(
  status: number,
  code: string,
  message: string,
  details: readonly { field: string | null; issue: string }[] = [],
) {
  return { status, body: { code, message, correlation_id: CORRELATION_ID, details } } as const;
}

export const MY_PRICED_EVENTS_RESPONSES = {
  list: {
    status: 200,
    body: {
      items: [DRAFT_WITHOUT_FEE, PUBLISHED_WITH_REGISTRATIONS, PUBLISHED_FREE],
      next_cursor: null,
    },
  },
  firstPage: {
    status: 200,
    body: { items: [DRAFT_WITHOUT_FEE], next_cursor: 'cursor-sintetico-tarifas-2' },
  },
  lastPage: {
    status: 200,
    body: { items: [PUBLISHED_WITH_REGISTRATIONS], next_cursor: null },
  },
  empty: { status: 200, body: { items: [], next_cursor: null } },
} as const satisfies Record<string, SimulatedResponse>;

const versionConflict = (current: number) =>
  error(409, 'version_conflict', 'El evento cambió.', [
    { field: 'expected_version', issue: String(current) },
  ]);

/** Respuestas de `PUT /v1/events/{event_id}/fee`. */
export const PUT_EVENT_FEE_RESPONSES = {
  /** CA1/CA4: nueva tarifa del publicado con inscritos; conservan la suya. */
  assigned: { status: 200, body: feeChanged(PUBLISHED_WITH_REGISTRATIONS, '90000.50') },
  /** `0.00`: el borrador queda gratuito. */
  free: { status: 200, body: feeChanged(DRAFT_WITHOUT_FEE, '0.00') },
  invalidAccessToken: error(401, 'invalid_access_token', 'La sesión no es válida.'),
  permissionRequired: error(403, 'permission_required', 'No tiene permiso.'),
  /** CA3: ajeno o inexistente. */
  eventNotFound: error(404, 'event_not_found', 'El evento no existe.'),
  /** CA3: versión obsoleta; `issue` es la versión vigente. */
  versionConflict: versionConflict(3),
  idempotencyKeyReused: error(409, 'idempotency_key_reused', 'La clave ya se usó.'),
  /** CA2: importe con más de dos decimales. */
  tooManyDecimals: error(422, 'validation_error', 'La tarifa no es válida.', [
    { field: 'amount', issue: 'too_many_decimals' },
  ]),
  /** CA2: fuera de rango. */
  outOfRange: error(422, 'validation_error', 'La tarifa no es válida.', [
    { field: 'amount', issue: 'out_of_range' },
  ]),
  /** CA2: moneda distinta de `COP`. */
  unsupportedCurrency: error(422, 'validation_error', 'La tarifa no es válida.', [
    { field: 'currency', issue: 'unsupported_currency' },
  ]),
  /** CA2: el evento ya comenzó. */
  eventAlreadyStarted: error(422, 'validation_error', 'La tarifa no es válida.', [
    { field: 'starts_at', issue: 'event_already_started' },
  ]),
  upstreamUnavailable: error(503, 'upstream_unavailable', 'El servicio no está disponible.'),
  upstreamTimeout: error(504, 'upstream_timeout', 'El servicio tardó demasiado en responder.'),
} as const satisfies Record<string, SimulatedResponse>;

/** Respuestas de `DELETE /v1/events/{event_id}/fee`. */
export const DELETE_EVENT_FEE_RESPONSES = {
  /** La tarifa queda en `null`; versión + 1. */
  removed: { status: 200, body: feeChanged(PUBLISHED_WITH_REGISTRATIONS, null) },
  invalidAccessToken: error(401, 'invalid_access_token', 'La sesión no es válida.'),
  permissionRequired: error(403, 'permission_required', 'No tiene permiso.'),
  eventNotFound: error(404, 'event_not_found', 'El evento no existe.'),
  versionConflict: versionConflict(3),
  eventAlreadyStarted: error(422, 'validation_error', 'La tarifa no es válida.', [
    { field: 'starts_at', issue: 'event_already_started' },
  ]),
  upstreamUnavailable: error(503, 'upstream_unavailable', 'El servicio no está disponible.'),
  upstreamTimeout: error(504, 'upstream_timeout', 'El servicio tardó demasiado en responder.'),
} as const satisfies Record<string, SimulatedResponse>;
