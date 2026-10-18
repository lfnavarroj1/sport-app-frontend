/**
 * Simulador de `POST /v1/sessions/revoke` (HU004) derivado del contrato bff-web
 * 0.15.0 (`src/app/core/api/contracts/bff-web.openapi.json`; la operación no
 * cambia desde 0.7.0). Lo usan las pruebas unitarias y Playwright;
 * `sessions.contract.spec.ts` valida cada respuesta contra el esquema del
 * contrato. Datos sintéticos.
 *
 * Archivo sin dependencias de Angular para poder importarlo desde Playwright.
 */
import { SimulatedResponse } from './register-user.fixtures';

export const REVOKE_SESSION_PATH = '/v1/sessions/revoke';

const CORRELATION_ID = '8d2f6a1c-3e4b-4c5d-9e6f-7a8b9c0d1e2f';

function error(status: number, code: string, message: string) {
  return { status, body: { code, message, correlation_id: CORRELATION_ID, details: [] } } as const;
}

export const REVOKE_SESSION_RESPONSES = {
  /** Sesión cerrada (también sin cookie o ya cerrada); la respuesta borra la cookie. */
  revoked: { status: 204, body: null },
  /** Falta `Origin` o no está permitido: el BFF no toca la cookie. */
  originNotAllowed: error(403, 'origin_not_allowed', 'Origen no permitido.'),
  /** Usuarios no respondió: el BFF borra la cookie, pero la revocación no se confirmó. */
  upstreamUnavailable: error(503, 'upstream_unavailable', 'El servicio no está disponible.'),
  upstreamTimeout: error(504, 'upstream_timeout', 'El servicio no respondió a tiempo.'),
} as const satisfies Record<string, SimulatedResponse>;

export const SIMULATED_REVOKE_CORRELATION_ID = CORRELATION_ID;
