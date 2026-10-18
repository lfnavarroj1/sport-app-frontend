/**
 * Simulador de `POST /v1/events` derivado del contrato bff-web 0.15.0
 * (`src/app/core/api/contracts/bff-web.openapi.json`) y de los ejemplos de
 * ADR-028. Lo usan las pruebas unitarias y Playwright; `events.contract.spec.ts`
 * valida cada respuesta contra el esquema del contrato. Datos sintéticos.
 *
 * Archivo sin dependencias de Angular para poder importarlo desde Playwright.
 */
import { SimulatedResponse } from './register-user.fixtures';

export const CREATE_EVENT_PATH = '/v1/events';
export const SIMULATED_EVENT_ID = '683f4e38-6bb3-4c47-a6dc-9bb1588c67ef';
export const SIMULATED_ORGANIZER_ID = '4a8a445c-a356-49d5-8d89-f36f6e327ad1';
const CORRELATION_ID = '2e4a6c8e-0a2c-4e6a-8c0e-2a4c6e8a0c2e';

/** Solicitud del ejemplo de ADR-028. */
export const VALID_CREATE_EVENT_REQUEST = {
  name: 'Carrera 10K Bogotá',
  description: 'Carrera recreativa de diez kilómetros para corredores aficionados.',
  discipline: 'Running',
  location: {
    name: 'Parque Metropolitano Simón Bolívar',
    address: 'Avenida Calle 63 # 60-50',
    city: 'Bogotá',
    country_code: 'CO',
  },
  starts_at: '2026-11-15T07:00:00-05:00',
  time_zone: 'America/Bogota',
  duration_minutes: 180,
  capacity: 5000,
} as const;

/** Respuesta `201` del ejemplo de ADR-028 (instantes en UTC). */
export const CREATED_EVENT = {
  event_id: SIMULATED_EVENT_ID,
  organizer_id: SIMULATED_ORGANIZER_ID,
  name: VALID_CREATE_EVENT_REQUEST.name,
  description: VALID_CREATE_EVENT_REQUEST.description,
  discipline: VALID_CREATE_EVENT_REQUEST.discipline,
  location: VALID_CREATE_EVENT_REQUEST.location,
  starts_at: '2026-11-15T12:00:00Z',
  ends_at: '2026-11-15T15:00:00Z',
  time_zone: 'America/Bogota',
  duration_minutes: 180,
  capacity: 5000,
  status: 'DRAFT',
  version: 1,
  created_at: '2026-10-12T21:00:00Z',
  updated_at: '2026-10-12T21:00:00Z',
} as const;

function error(
  status: number,
  code: string,
  message: string,
  details: readonly { field: string | null; issue: string }[] = [],
) {
  return { status, body: { code, message, correlation_id: CORRELATION_ID, details } } as const;
}

export const CREATE_EVENT_RESPONSES = {
  created: { status: 201, body: CREATED_EVENT },
  invalidAccessToken: error(401, 'invalid_access_token', 'La sesión no es válida.'),
  permissionRequired: error(403, 'permission_required', 'No tiene permiso para crear eventos.'),
  idempotencyKeyReused: error(
    409,
    'idempotency_key_reused',
    'La clave de idempotencia ya se usó con otra solicitud.',
  ),
  /** Varias reglas incumplidas a la vez, con rutas y motivos de ADR-028. */
  validationError: error(422, 'validation_error', 'La solicitud no es válida.', [
    { field: 'starts_at', issue: 'not_in_future' },
    { field: 'time_zone', issue: 'time_zone_offset_mismatch' },
    { field: 'location.country_code', issue: 'unknown_value' },
    { field: 'capacity', issue: 'out_of_range' },
  ]),
  upstreamUnavailable: error(503, 'upstream_unavailable', 'El servicio no está disponible.'),
  upstreamTimeout: error(504, 'upstream_timeout', 'El servicio tardó demasiado en responder.'),
} as const satisfies Record<string, SimulatedResponse>;

export const SIMULATED_EVENT_CORRELATION_ID = CORRELATION_ID;
