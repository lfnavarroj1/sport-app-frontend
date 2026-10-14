/**
 * Simulador de `POST /v1/sessions/refresh` derivado del contrato bff-web 0.12.0
 * (`src/app/core/api/contracts/bff-web.openapi.json`). Lo usan las pruebas
 * unitarias y Playwright; `sessions.contract.spec.ts` valida cada respuesta contra
 * el esquema del contrato. Datos y tokens sintéticos: no son JWT válidos.
 *
 * Archivo sin dependencias de Angular para poder importarlo desde Playwright.
 */
import { CREATE_SESSION_RESPONSES } from './create-session.fixtures';
import { SimulatedResponse } from './register-user.fixtures';

export const REFRESH_SESSION_PATH = '/v1/sessions/refresh';

const CORRELATION_ID = '4c1e8f2a-6b3d-4e7a-9f10-2a3b4c5d6e7f';

export const SIMULATED_RENEWED_ACCESS_TOKEN = 'token-de-acceso-renovado-sintetico';

export const REFRESH_SESSION_RESPONSES = {
  renewed: {
    status: 200,
    body: {
      ...CREATE_SESSION_RESPONSES.authenticated.body,
      access_token: SIMULATED_RENEWED_ACCESS_TOKEN,
    },
  },
  invalidRefreshToken: {
    status: 401,
    body: {
      code: 'invalid_refresh_token',
      message: 'La sesión no es válida.',
      correlation_id: CORRELATION_ID,
      details: [],
    },
  },
  originNotAllowed: {
    status: 403,
    body: {
      code: 'origin_not_allowed',
      message: 'Origen no permitido.',
      correlation_id: CORRELATION_ID,
      details: [],
    },
  },
  upstreamUnavailable: {
    status: 503,
    body: {
      code: 'upstream_unavailable',
      message: 'El servicio no está disponible.',
      correlation_id: CORRELATION_ID,
      details: [],
    },
  },
  upstreamTimeout: {
    status: 504,
    body: {
      code: 'upstream_timeout',
      message: 'El servicio no respondió a tiempo.',
      correlation_id: CORRELATION_ID,
      details: [],
    },
  },
} as const satisfies Record<string, SimulatedResponse>;
