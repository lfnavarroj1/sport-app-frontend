/**
 * Simulador de la cuenta del usuario (HU002) derivado del contrato bff-web 0.28.0
 * (`src/app/core/api/contracts/bff-web.openapi.json`) y de ADR-035:
 * `GET /v1/me/account` y `PUT /v1/me/account`. Lo usan las pruebas unitarias y
 * Playwright; `account.contract.spec.ts` valida cada respuesta contra el esquema
 * del contrato. Datos sintéticos.
 *
 * Archivo sin dependencias de Angular para poder importarlo desde Playwright.
 */
import { SimulatedResponse } from './register-user.fixtures';

export const ACCOUNT_PATH = '/v1/me/account';

/** Mismo usuario que la sesión simulada de `create-session.fixtures.ts`. */
export const SIMULATED_ACCOUNT_USER_ID = '0b9f6c1e-3d2a-4f5b-8c7d-1e2f3a4b5c6d';
const CORRELATION_ID = '3e7a1c9d-5b2f-4d6e-8a0b-1c2d3e4f5a6b';

/** Cuenta proyectada en la versión 1, con el nombre y el correo de la sesión simulada. */
export const ACCOUNT_READ = {
  user_id: SIMULATED_ACCOUNT_USER_ID,
  full_name: 'Persona Sintética',
  email: 'persona@example.com',
  actor_type: 'athlete',
  status: 'active',
  version: 1,
  projected_at: '2026-10-12T13:00:00Z',
} as const;

/** Solicitud válida: nombre y correo nuevos sobre la versión 1. */
export const VALID_ACCOUNT_REQUEST = {
  expected_version: 1,
  full_name: 'Persona Renombrada',
  email: 'persona.nueva@example.com',
} as const;

/** Cuenta confirmada en la versión 2 tras la solicitud válida. */
export const ACCOUNT_UPDATED = {
  user_id: SIMULATED_ACCOUNT_USER_ID,
  full_name: VALID_ACCOUNT_REQUEST.full_name,
  email: VALID_ACCOUNT_REQUEST.email,
  actor_type: 'athlete',
  status: 'active',
  version: 2,
  updated_at: '2026-10-13T08:00:00Z',
} as const;

function error(
  status: number,
  code: string,
  message: string,
  details: readonly { field: string | null; issue: string }[] = [],
) {
  return { status, body: { code, message, correlation_id: CORRELATION_ID, details } } as const;
}

export const GET_ACCOUNT_RESPONSES = {
  found: { status: 200, body: ACCOUNT_READ },
  /** La proyección ya alcanzó la versión 2. */
  projectedUpdate: {
    status: 200,
    body: {
      ...ACCOUNT_READ,
      full_name: ACCOUNT_UPDATED.full_name,
      email: ACCOUNT_UPDATED.email,
      version: 2,
      projected_at: '2026-10-13T08:00:02Z',
    },
  },
  invalidAccessToken: error(401, 'invalid_access_token', 'La sesión no es válida.'),
  userNotFound: error(404, 'user_not_found', 'La cuenta aún no está disponible.'),
  upstreamUnavailable: error(503, 'upstream_unavailable', 'El servicio no está disponible.'),
  upstreamTimeout: error(504, 'upstream_timeout', 'El servicio tardó demasiado en responder.'),
} as const satisfies Record<string, SimulatedResponse>;

export const PUT_ACCOUNT_RESPONSES = {
  updated: { status: 200, body: ACCOUNT_UPDATED },
  invalidAccessToken: error(401, 'invalid_access_token', 'La sesión no es válida.'),
  /** La cuenta ya está en la versión 3: el cliente envió una versión anterior (CA4). */
  versionConflict: error(409, 'version_conflict', 'La cuenta cambió.', [
    { field: 'expected_version', issue: '3' },
  ]),
  /** El correo pertenece a otra cuenta; no revela nada de ella (CA3). */
  emailAlreadyRegistered: error(409, 'email_already_registered', 'No es posible usar ese correo.'),
  idempotencyKeyReused: error(
    409,
    'idempotency_key_reused',
    'La clave de idempotencia ya se usó con otra solicitud.',
  ),
  /** Nombre vacío y correo mal formado (catálogo de ADR-034). */
  validationError: error(422, 'validation_error', 'La solicitud no es válida.', [
    { field: 'full_name', issue: 'invalid_length' },
    { field: 'email', issue: 'unknown_value' },
  ]),
  /** Campo que no se edita con esta operación (CA2). */
  fieldNotAllowed: error(422, 'validation_error', 'La solicitud no es válida.', [
    { field: 'actor_type', issue: 'field_not_allowed' },
  ]),
  upstreamUnavailable: error(503, 'upstream_unavailable', 'El servicio no está disponible.'),
  upstreamTimeout: error(504, 'upstream_timeout', 'El servicio tardó demasiado en responder.'),
} as const satisfies Record<string, SimulatedResponse>;

export const SIMULATED_ACCOUNT_CORRELATION_ID = CORRELATION_ID;
