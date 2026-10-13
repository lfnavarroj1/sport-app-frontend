/**
 * Simulador de las operaciones de HU010 derivado del contrato bff-web 0.8.0
 * (`src/app/core/api/contracts/bff-web.openapi.json`):
 * `POST /v1/me/training-authorizations`,
 * `DELETE /v1/me/training-authorizations/{professional_id}`,
 * `POST /v1/training-plans` y `GET /v1/training-plans/{plan_id}`.
 *
 * Los motivos de `details` en `training_plan_invalid` no están enumerados en el
 * OpenAPI; se toman de `training_management` en `sport-app-backend` `67a239d`
 * (`domain/plans/model.py`), que los reenvía con el prefijo `body.`. Lo usan las
 * pruebas unitarias y Playwright; `training.contract.spec.ts` valida cada
 * respuesta contra el esquema del contrato. Datos sintéticos.
 *
 * Archivo sin dependencias de Angular para poder importarlo desde Playwright.
 */
import { SimulatedResponse } from './register-user.fixtures';

export const TRAINING_AUTHORIZATIONS_PATH = '/v1/me/training-authorizations';
export const TRAINING_PLANS_PATH = '/v1/training-plans';

export const SIMULATED_ATHLETE_ID = '5d1e7a3c-2b4f-4c6d-8e9f-0a1b2c3d4e5f';
export const SIMULATED_PROFESSIONAL_ID = '7f2e4d6c-8b0a-4e1c-9d3f-5a7b9c1d3e5f';
export const SIMULATED_PLAN_ID = '3c5e7a9b-1d2f-4a6c-8e0b-2d4f6a8c0e1b';
const CORRELATION_ID = '4b6d8f0a-2c4e-4f6a-8b0d-1e3f5a7c9e2d';

export const VALID_GRANT_AUTHORIZATION_REQUEST = {
  professional_email: 'profesional@example.com',
} as const;

export const VALID_CREATE_TRAINING_PLAN_REQUEST = {
  athlete_email: 'deportista@example.com',
  title: 'Base aeróbica de 8 semanas',
  objectives: ['Mejorar la resistencia aeróbica', 'Preparar una carrera de 10 km'],
  start_date: '2026-11-02',
  end_date: '2026-12-27',
  sessions: [
    { scheduled_date: '2026-11-03', sport: 'running', duration_minutes: 45, intensity_rpe: 4 },
    { scheduled_date: '2026-11-05', sport: 'cycling', duration_minutes: 60, intensity_rpe: 6 },
  ],
} as const;

function error(
  status: number,
  code: string,
  message: string,
  details: readonly { field: string | null; issue: string }[] = [],
) {
  return { status, body: { code, message, correlation_id: CORRELATION_ID, details } } as const;
}

const invalidAccessToken = error(401, 'invalid_access_token', 'La sesión no es válida.');
const upstreamUnavailable = error(
  503,
  'upstream_unavailable',
  'El servicio no está disponible. Intente de nuevo.',
);
const upstreamTimeout = error(504, 'upstream_timeout', 'El servicio tardó demasiado en responder.');

const authorization = {
  athlete_id: SIMULATED_ATHLETE_ID,
  professional_id: SIMULATED_PROFESSIONAL_ID,
  status: 'ACTIVE',
  granted_at: '2026-10-12T15:30:00Z',
} as const;

export const GRANT_AUTHORIZATION_RESPONSES = {
  granted: { status: 201, body: authorization },
  alreadyActive: { status: 200, body: authorization },
  invalidAccessToken,
  permissionRequired: error(403, 'permission_required', 'Solo el deportista puede autorizar.'),
  capabilityRequired: error(403, 'capability_required', 'El plan no incluye esta capacidad.'),
  professionalNotFound: error(404, 'professional_not_found', 'El profesional no existe.'),
  validationError: error(422, 'validation_error', 'La solicitud no es válida.', [
    { field: 'body.professional_email', issue: 'value_error' },
  ]),
  upstreamUnavailable,
  upstreamTimeout,
} as const satisfies Record<string, SimulatedResponse>;

export const REVOKE_AUTHORIZATION_RESPONSES = {
  revoked: { status: 204, body: null },
  invalidAccessToken,
  permissionRequired: error(403, 'permission_required', 'Solo el deportista puede revocar.'),
  upstreamUnavailable,
  upstreamTimeout,
} as const satisfies Record<string, SimulatedResponse>;

const plan = {
  plan_id: SIMULATED_PLAN_ID,
  athlete_id: SIMULATED_ATHLETE_ID,
  professional_id: SIMULATED_PROFESSIONAL_ID,
  title: VALID_CREATE_TRAINING_PLAN_REQUEST.title,
  objectives: VALID_CREATE_TRAINING_PLAN_REQUEST.objectives,
  start_date: VALID_CREATE_TRAINING_PLAN_REQUEST.start_date,
  end_date: VALID_CREATE_TRAINING_PLAN_REQUEST.end_date,
  status: 'ASSIGNED',
  version: 1,
  sessions: VALID_CREATE_TRAINING_PLAN_REQUEST.sessions,
  created_at: '2026-10-12T16:00:00Z',
} as const;

export const CREATE_TRAINING_PLAN_RESPONSES = {
  created: { status: 201, body: plan },
  invalidAccessToken,
  permissionRequired: error(403, 'permission_required', 'No tiene permiso para crear planes.'),
  athleteAuthorizationRequired: error(
    403,
    'athlete_authorization_required',
    'El deportista no ha autorizado al profesional.',
  ),
  idempotencyKeyReused: error(
    409,
    'idempotency_key_reused',
    'La clave de idempotencia ya se usó con otra solicitud.',
  ),
  validationError: error(422, 'validation_error', 'La solicitud no es válida.', [
    { field: 'body.sessions.0.intensity_rpe', issue: 'less_than_equal' },
  ]),
  trainingPlanInvalid: error(422, 'training_plan_invalid', 'El plan no es coherente.', [
    { field: 'body.end_date', issue: 'end_date_before_start_date' },
    { field: 'body.sessions.1.scheduled_date', issue: 'outside_plan_period' },
    { field: 'body.sessions.1.scheduled_date', issue: 'too_many_sessions_per_day' },
  ]),
  upstreamUnavailable,
  upstreamTimeout,
} as const satisfies Record<string, SimulatedResponse>;

export const GET_TRAINING_PLAN_RESPONSES = {
  found: { status: 200, body: plan },
  invalidAccessToken,
  permissionRequired: error(403, 'permission_required', 'No tiene permiso para ver el plan.'),
  capabilityRequired: error(403, 'capability_required', 'El plan no incluye esta capacidad.'),
  trainingPlanNotFound: error(404, 'training_plan_not_found', 'El plan no existe.'),
  upstreamUnavailable,
  upstreamTimeout,
} as const satisfies Record<string, SimulatedResponse>;

export const SIMULATED_TRAINING_CORRELATION_ID = CORRELATION_ID;
