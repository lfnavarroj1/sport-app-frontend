/**
 * Simulador de `POST /v1/users` derivado del contrato bff-web 0.2.0
 * (`src/app/core/api/contracts/bff-web.openapi.json`). Lo usan las pruebas
 * unitarias y Playwright; `users.contract.spec.ts` valida cada respuesta contra
 * el esquema del contrato. Datos sintéticos.
 *
 * Archivo sin dependencias de Angular para poder importarlo desde Playwright.
 */

export const REGISTER_USER_PATH = '/v1/users';

export interface SimulatedResponse {
  readonly status: number;
  readonly body: unknown;
}

export const VALID_REGISTER_USER_REQUEST = {
  full_name: 'Persona Sintética',
  email: 'persona@example.com',
  password: 'clave-sintetica-123',
  actor_type: 'athlete',
  accepted_policies_version: 'local-dev',
} as const;

const CORRELATION_ID = '6f1c2a5e-8b9d-4c3e-9f10-2a3b4c5d6e7f';

export const REGISTER_USER_RESPONSES = {
  registered: {
    status: 201,
    body: {
      user_id: '0b9f6c1e-3d2a-4f5b-8c7d-1e2f3a4b5c6d',
      full_name: 'Persona Sintética',
      email: 'persona@example.com',
      actor_type: 'athlete',
      status: 'active',
      aggregate_version: 1,
      created_at: '2026-10-10T12:00:00Z',
    },
  },
  emailAlreadyRegistered: {
    status: 409,
    body: {
      code: 'email_already_registered',
      message: 'El correo ya está registrado.',
      correlation_id: CORRELATION_ID,
      details: [],
    },
  },
  idempotencyKeyReused: {
    status: 409,
    body: {
      code: 'idempotency_key_reused',
      message: 'La clave de idempotencia ya se usó con otra solicitud.',
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
      details: [
        { field: 'body.email', issue: 'value_error' },
        { field: 'body.password', issue: 'string_too_short' },
      ],
    },
  },
  policiesVersionMismatch: {
    status: 422,
    body: {
      code: 'policies_version_mismatch',
      message: 'La versión de políticas no es la vigente.',
      correlation_id: CORRELATION_ID,
      details: [{ field: 'body.accepted_policies_version', issue: 'policies_version_mismatch' }],
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

export const SIMULATED_CORRELATION_ID = CORRELATION_ID;
