/**
 * Simulador de `GET /v1/me/capabilities` derivado del contrato bff-web 0.8.0
 * (`src/app/core/api/contracts/bff-web.openapi.json`). Los códigos de capacidad
 * salen de ADR-024 y los permisos de `contracts/authorization/actor-permissions.v1.json`
 * del backend, filtrados al canal web como hace el BFF. Lo usan las pruebas
 * unitarias y Playwright; `capabilities.contract.spec.ts` valida cada respuesta
 * contra el esquema del contrato. Datos sintéticos.
 *
 * Archivo sin dependencias de Angular para poder importarlo desde Playwright.
 */
import { SimulatedResponse } from './register-user.fixtures';

export const GET_CAPABILITIES_PATH = '/v1/me/capabilities';

const CORRELATION_ID = '9e8d7c6b-5a49-4382-a1b0-c9d8e7f6a5b4';
const EVALUATED_AT = '2026-10-12T12:00:00Z';
const POLICY_VERSION = 'actor-permissions.v1';
const CATALOG_VERSION = 'plans-2026-10-11.v1';

/** Capacidades del plan `FREE` (ADR-024). */
export const FREE_CAPABILITIES = [
  'training.plan.manage',
  'training.routes.suggest',
  'events.suggest',
  'training.plans.suggest',
  'services.support.suggest',
  'nutrition.routines.suggest',
  'integrations.strava.connect',
  'training.session.record',
  'training.dashboard.view',
  'training.metrics.ftp_vo2max',
  'calendar.sport.view',
] as const;

/** Capacidades del plan `PREMIUM`: todo `INTERMEDIATE` más las propias (ADR-024). */
export const PREMIUM_CAPABILITIES = [
  ...FREE_CAPABILITIES,
  'training.realtime.monitor',
  'devices.measurement.connect',
  'nutrition.session.reminders',
  'services.sports_medicine.access',
  'services.virtual_sessions.schedule',
] as const;

/** Permisos web del organizador en `actor-permissions.v1`. */
export const ORGANIZER_WEB_PERMISSIONS = [
  'events.create',
  'events.attendees.view',
  'events.calendar.view',
  'events.publish',
  'events.pricing.manage',
  'calendar.integrated.view',
] as const;

/** Permisos web del profesional en `actor-permissions.v1`. */
export const SERVICE_PROVIDER_WEB_PERMISSIONS = [
  'services.create',
  'services.publish',
  'training.plan.author',
  'training.history.view_assigned',
  'health.history.view_assigned',
  'nutrition.history.view_assigned',
  'nutrition.plan.author',
  'calendar.integrated.view',
] as const;

function athlete(planCode: string, capabilities: readonly string[]) {
  return {
    status: 200,
    body: {
      actor_type: 'athlete',
      subscription_status: 'ACTIVE',
      plan_code: planCode,
      plan_version: 1,
      catalog_version: CATALOG_VERSION,
      authorization_policy_version: POLICY_VERSION,
      permissions: [],
      capabilities,
      evaluated_at: EVALUATED_AT,
    },
  } as const;
}

function notApplicable(actorType: string, permissions: readonly string[]) {
  return {
    status: 200,
    body: {
      actor_type: actorType,
      subscription_status: 'NOT_APPLICABLE',
      plan_code: null,
      plan_version: null,
      catalog_version: null,
      authorization_policy_version: POLICY_VERSION,
      permissions,
      capabilities: [],
      evaluated_at: EVALUATED_AT,
    },
  } as const;
}

function error(status: number, code: string, message: string) {
  return {
    status,
    body: { code, message, correlation_id: CORRELATION_ID, details: [] },
  } as const;
}

export const GET_CAPABILITIES_RESPONSES = {
  athleteFree: athlete('FREE', FREE_CAPABILITIES),
  athletePremium: athlete('PREMIUM', PREMIUM_CAPABILITIES),
  athleteProvisioning: {
    status: 200,
    body: {
      actor_type: 'athlete',
      subscription_status: 'PROVISIONING',
      plan_code: null,
      plan_version: null,
      catalog_version: null,
      authorization_policy_version: POLICY_VERSION,
      permissions: [],
      capabilities: [],
      evaluated_at: EVALUATED_AT,
    },
  },
  organizer: notApplicable('organizer', ORGANIZER_WEB_PERMISSIONS),
  serviceProvider: notApplicable('service_provider', SERVICE_PROVIDER_WEB_PERMISSIONS),
  invalidAccessToken: error(401, 'invalid_access_token', 'La sesión no es válida.'),
  unsupportedActorType: error(403, 'unsupported_actor_type', 'Tipo de usuario no admitido.'),
  upstreamUnavailable: error(
    503,
    'upstream_unavailable',
    'No fue posible evaluar las capacidades. Intente de nuevo.',
  ),
} as const satisfies Record<string, SimulatedResponse>;

export const SIMULATED_CAPABILITIES_CORRELATION_ID = CORRELATION_ID;

/** Respuesta `200` del simulador que corresponde a cada tipo de actor. */
export function capabilitiesFor(actorType: string): SimulatedResponse {
  switch (actorType) {
    case 'athlete':
      return GET_CAPABILITIES_RESPONSES.athleteFree;
    case 'organizer':
      return GET_CAPABILITIES_RESPONSES.organizer;
    case 'service_provider':
      return GET_CAPABILITIES_RESPONSES.serviceProvider;
    default:
      return GET_CAPABILITIES_RESPONSES.unsupportedActorType;
  }
}
