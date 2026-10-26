/**
 * Simulador de `POST /v1/services` derivado del contrato bff-web 0.16.0
 * (`src/app/core/api/contracts/bff-web.openapi.json`) y de los ejemplos de
 * ADR-027. Lo usan las pruebas unitarias y Playwright; `services.contract.spec.ts`
 * valida cada respuesta contra el esquema del contrato. Datos sintéticos.
 *
 * Archivo sin dependencias de Angular para poder importarlo desde Playwright.
 */
import { SimulatedResponse } from './register-user.fixtures';

export const CREATE_SERVICE_PATH = '/v1/services';
export const SIMULATED_SERVICE_ID = '8e2885fb-ef5d-42ad-a02e-6ef5f97f377d';
export const SIMULATED_SERVICE_PROVIDER_ID = 'a0df531d-f292-4825-b074-a406c9a6ce55';
const CORRELATION_ID = '3c5e7a9c-1e3a-4c5e-9a1c-3e5a7c9e1a3c';

/** Solicitud del ejemplo de ADR-027, con un intervalo de una hora en Bogotá. */
export const VALID_CREATE_SERVICE_REQUEST = {
  name: 'Valoración deportiva inicial',
  description: 'Valoración presencial para orientar el plan deportivo.',
  category: 'SPORTS_MEDICINE',
  modality: 'IN_PERSON',
  price: {
    amount: '120000.00',
    currency: 'COP',
    billing_unit: 'SESSION',
  },
  availability: [
    {
      starts_at: '2026-11-20T09:00:00-05:00',
      ends_at: '2026-11-20T10:00:00-05:00',
      time_zone: 'America/Bogota',
      capacity: 1,
    },
  ],
} as const;

/** Respuesta `201` del ejemplo de ADR-027: borrador, versión 1 e instantes en UTC. */
export const CREATED_SERVICE = {
  service_id: SIMULATED_SERVICE_ID,
  provider_id: SIMULATED_SERVICE_PROVIDER_ID,
  name: VALID_CREATE_SERVICE_REQUEST.name,
  description: VALID_CREATE_SERVICE_REQUEST.description,
  category: VALID_CREATE_SERVICE_REQUEST.category,
  modality: VALID_CREATE_SERVICE_REQUEST.modality,
  price: VALID_CREATE_SERVICE_REQUEST.price,
  availability: [
    {
      starts_at: '2026-11-20T14:00:00Z',
      ends_at: '2026-11-20T15:00:00Z',
      time_zone: 'America/Bogota',
      capacity: 1,
    },
  ],
  status: 'DRAFT',
  version: 1,
  created_at: '2026-10-21T15:00:00Z',
  updated_at: '2026-10-21T15:00:00Z',
  published_at: null,
} as const;

function error(
  status: number,
  code: string,
  message: string,
  details: readonly { field: string | null; issue: string }[] = [],
) {
  return { status, body: { code, message, correlation_id: CORRELATION_ID, details } } as const;
}

export const CREATE_SERVICE_RESPONSES = {
  created: { status: 201, body: CREATED_SERVICE },
  invalidAccessToken: error(401, 'invalid_access_token', 'La sesión no es válida.'),
  permissionRequired: error(403, 'permission_required', 'No tiene permiso para crear servicios.'),
  idempotencyKeyReused: error(
    409,
    'idempotency_key_reused',
    'La clave de idempotencia ya se usó con otra solicitud.',
  ),
  /** Varias reglas incumplidas a la vez, con las rutas y los motivos de ADR-027. */
  validationError: error(422, 'validation_error', 'La solicitud no es válida.', [
    { field: 'price.amount', issue: 'too_many_decimals' },
    { field: 'availability[0].time_zone', issue: 'time_zone_offset_mismatch' },
    { field: 'availability[1].starts_at', issue: 'overlapping_interval' },
    { field: 'availability[1].ends_at', issue: 'out_of_range' },
  ]),
  upstreamUnavailable: error(503, 'upstream_unavailable', 'El servicio no está disponible.'),
  upstreamTimeout: error(504, 'upstream_timeout', 'El servicio tardó demasiado en responder.'),
} as const satisfies Record<string, SimulatedResponse>;

export const SIMULATED_SERVICE_CORRELATION_ID = CORRELATION_ID;
