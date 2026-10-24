/**
 * Simulador de HU016 derivado del contrato bff-web 0.20.0
 * (`src/app/core/api/contracts/bff-web.openapi.json`) y del catálogo
 * `plans-2026-10-13.v1` de ADR-036: `GET /v1/plans`, `GET /v1/me/subscription` y
 * `POST /v1/me/subscription/changes`. Las capacidades por plan son las de ADR-024
 * (los planes superiores heredan las del nivel anterior). Lo usan las pruebas
 * unitarias y Playwright; `affiliation.contract.spec.ts` valida cada respuesta
 * contra el esquema de su operación. Datos sintéticos.
 *
 * Archivo sin dependencias de Angular para poder importarlo desde Playwright.
 */
import { FREE_CAPABILITIES, PREMIUM_CAPABILITIES } from './capabilities.fixtures';
import { SimulatedResponse } from './register-user.fixtures';

export const PLANS_PATH = '/v1/plans';
export const MY_SUBSCRIPTION_PATH = '/v1/me/subscription';
export const SUBSCRIPTION_CHANGES_PATH = '/v1/me/subscription/changes';
export const SIMULATED_CATALOG_VERSION = 'plans-2026-10-13.v1';
const CORRELATION_ID = '5a7c9e1b-3d5f-4a7c-9e1b-3d5f7a9c1e5b';

/** Capacidades propias de `INTERMEDIATE` (ADR-024). */
export const INTERMEDIATE_OWN_CAPABILITIES = [
  'training.realtime.monitor',
  'devices.measurement.connect',
  'nutrition.session.reminders',
] as const;
export const INTERMEDIATE_CAPABILITIES = [
  ...FREE_CAPABILITIES,
  ...INTERMEDIATE_OWN_CAPABILITIES,
] as const;

type Periodicity = 'NONE' | 'MONTHLY' | 'QUARTERLY' | 'ANNUAL';

const offer = (periodicity: Periodicity, price: string, months: number | null) => ({
  periodicity,
  price,
  currency: 'COP' as const,
  duration_months: months,
});

/** Catálogo de ADR-036 en el orden de nivel. */
export const SIMULATED_PLANS = [
  {
    plan_code: 'FREE',
    name: 'Gratuito',
    description: 'Planes de entrenamiento, sugerencias, Strava, sesiones y calendario deportivo.',
    level: 1,
    version: 2,
    selectable: true,
    capabilities: FREE_CAPABILITIES,
    offers: [offer('NONE', '0.00', null)],
  },
  {
    plan_code: 'INTERMEDIATE',
    name: 'Intermedio',
    description: 'Todo lo gratuito más monitoreo en tiempo real, dispositivos y recordatorios.',
    level: 2,
    version: 2,
    selectable: true,
    capabilities: INTERMEDIATE_CAPABILITIES,
    offers: [
      offer('MONTHLY', '2400.00', 1),
      offer('QUARTERLY', '7200.00', 3),
      offer('ANNUAL', '28800.00', 12),
    ],
  },
  {
    plan_code: 'PREMIUM',
    name: 'Premium',
    description: 'Todo lo intermedio más servicios médicos y deportivos y sesiones virtuales.',
    level: 3,
    version: 2,
    selectable: true,
    capabilities: PREMIUM_CAPABILITIES,
    offers: [
      offer('MONTHLY', '4800.00', 1),
      offer('QUARTERLY', '14400.00', 3),
      offer('ANNUAL', '57600.00', 12),
    ],
  },
] as const;

/** Respuesta de `GET /v1/plans` con el plan actual indicado. */
export function plansResponse(currentPlanCode: string | null = 'FREE') {
  return {
    catalog_version: SIMULATED_CATALOG_VERSION,
    current_plan_code: currentPlanCode,
    plans: SIMULATED_PLANS,
  };
}

/** Suscripción vigente sintética (`ACTIVE`). */
export function activeSubscription(
  planCode: string,
  periodicity: Periodicity,
  version: number,
  price: string | null,
  periodEnd: string | null,
) {
  return {
    subscription_id: `3b5d7f9a-1c3e-4a5b-8d7f-${String(version).padStart(12, '0')}`,
    plan_code: planCode,
    plan_version: 2,
    periodicity,
    price,
    period_start: '2026-10-24T15:00:00Z',
    period_end: periodEnd,
    status: 'ACTIVE' as const,
    origin: version === 1 ? ('AUTO_REGISTRATION' as const) : ('USER_CHANGE' as const),
    version,
  };
}

export const FREE_SUBSCRIPTION = activeSubscription('FREE', 'NONE', 1, '0.00', null);
export const PREMIUM_QUARTERLY_SUBSCRIPTION = activeSubscription(
  'PREMIUM',
  'QUARTERLY',
  2,
  '14400.00',
  '2027-01-24T15:00:00Z',
);

export const PROVISIONING_SUBSCRIPTION = {
  subscription_id: null,
  plan_code: null,
  plan_version: null,
  periodicity: null,
  price: null,
  period_start: null,
  period_end: null,
  status: 'PROVISIONING' as const,
  origin: null,
  version: null,
};

/** Cuerpo válido: pasar de `FREE` a `PREMIUM` trimestral. */
export const VALID_SUBSCRIPTION_CHANGE_REQUEST = {
  plan_code: 'PREMIUM',
  periodicity: 'QUARTERLY',
  expected_subscription_version: 1,
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
const permissionRequired = error(403, 'permission_required', 'Solo el deportista.');
const upstreamUnavailable = error(503, 'upstream_unavailable', 'El servicio no está disponible.');
const upstreamTimeout = error(504, 'upstream_timeout', 'El servicio tardó demasiado en responder.');

export const PLANS_RESPONSES = {
  free: { status: 200, body: plansResponse('FREE') },
  provisioning: { status: 200, body: plansResponse(null) },
  invalidAccessToken,
  permissionRequired,
  upstreamUnavailable,
  upstreamTimeout,
} as const satisfies Record<string, SimulatedResponse>;

export const MY_SUBSCRIPTION_RESPONSES = {
  free: { status: 200, body: FREE_SUBSCRIPTION },
  provisioning: { status: 200, body: PROVISIONING_SUBSCRIPTION },
  invalidAccessToken,
  permissionRequired,
  upstreamUnavailable,
  upstreamTimeout,
} as const satisfies Record<string, SimulatedResponse>;

export const SUBSCRIPTION_CHANGE_RESPONSES = {
  /** CA1: `FREE` → `PREMIUM` trimestral, versión 2 con periodo. */
  changed: { status: 200, body: PREMIUM_QUARTERLY_SUBSCRIPTION },
  /** Volver a `FREE`: sin precio de oferta ni fin de periodo. */
  backToFree: { status: 200, body: activeSubscription('FREE', 'NONE', 3, '0.00', null) },
  invalidAccessToken,
  permissionRequired,
  planNotFound: error(404, 'plan_not_found', 'El plan no existe.'),
  planNotSelectable: error(409, 'plan_not_selectable', 'El plan no es seleccionable.'),
  subscriptionUnchanged: error(409, 'subscription_unchanged', 'Ya tiene ese plan y periodicidad.'),
  subscriptionProvisioning: error(
    409,
    'subscription_provisioning',
    'La suscripción gratuita aún se está activando.',
  ),
  versionConflict: error(409, 'version_conflict', 'La suscripción cambió.', [
    { field: 'body.expected_subscription_version', issue: '2' },
  ]),
  idempotencyKeyReused: error(409, 'idempotency_key_reused', 'La clave ya se usó con otro cambio.'),
  inconsistentPeriodicity: error(422, 'validation_error', 'La solicitud no es válida.', [
    { field: 'body.periodicity', issue: 'inconsistent_values' },
  ]),
  upstreamUnavailable,
  upstreamTimeout,
} as const satisfies Record<string, SimulatedResponse>;

export const SIMULATED_AFFILIATION_CORRELATION_ID = CORRELATION_ID;
