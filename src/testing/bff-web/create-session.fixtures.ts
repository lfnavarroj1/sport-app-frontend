/**
 * Simulador de `POST /v1/sessions` derivado del contrato bff-web 0.16.0
 * (`src/app/core/api/contracts/bff-web.openapi.json`). Lo usan las pruebas
 * unitarias y Playwright; `sessions.contract.spec.ts` valida cada respuesta contra
 * el esquema del contrato. Datos y tokens sintéticos: no son JWT válidos.
 *
 * Archivo sin dependencias de Angular para poder importarlo desde Playwright.
 */
import { SimulatedResponse } from './register-user.fixtures';

export const CREATE_SESSION_PATH = '/v1/sessions';

export const VALID_LOGIN_REQUEST = {
  email: 'persona@example.com',
  password: 'clave-sintetica-123',
} as const;

const CORRELATION_ID = '7a2d3b6f-9c0e-4d1f-8a21-3b4c5d6e7f80';

export const SIMULATED_ACCESS_TOKEN = 'token-de-acceso-sintetico';
/** `Retry-After` simulado (segundos) para `too_many_attempts`. */
export const SIMULATED_RETRY_AFTER = 600;

export const CREATE_SESSION_RESPONSES = {
  authenticated: {
    status: 200,
    body: {
      token_type: 'Bearer',
      access_token: SIMULATED_ACCESS_TOKEN,
      expires_in: 900,
      refresh_expires_in: 604800,
      user: {
        user_id: '0b9f6c1e-3d2a-4f5b-8c7d-1e2f3a4b5c6d',
        full_name: 'Persona Sintética',
        email: 'persona@example.com',
        actor_type: 'organizer',
      },
    },
  },
  invalidCredentials: {
    status: 401,
    body: {
      code: 'invalid_credentials',
      message: 'Credenciales inválidas.',
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
  tooManyAttempts: {
    status: 429,
    body: {
      code: 'too_many_attempts',
      message: 'Demasiados intentos.',
      correlation_id: CORRELATION_ID,
      details: [],
    },
  },
  validationError: {
    status: 422,
    body: {
      code: 'validation_error',
      message: 'La solicitud no es válida.',
      correlation_id: CORRELATION_ID,
      details: [{ field: 'body.email', issue: 'string_too_short' }],
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

export const SIMULATED_SESSION_CORRELATION_ID = CORRELATION_ID;
