import { ApiError } from '../../../core/api/api-error';
import {
  PeriodicityDto,
  PlanDto,
  PlansResponseDto,
  SubscriptionChangeRequestDto,
  SubscriptionResponseDto,
  SubscriptionStatusDto,
} from '../../../core/api/bff-web/affiliation.api';

/**
 * Modelo de pantalla de «Mi plan» (HU016, ADR-036). Transforma el transporte de
 * `GET /v1/plans` y `GET /v1/me/subscription` sin replicar reglas del dominio: qué
 * plan es seleccionable, la coherencia de la periodicidad y el resultado del
 * cambio los decide el backend.
 */

export type Periodicity = PeriodicityDto;

export interface PlanOffer {
  readonly periodicity: Periodicity;
  /** Cadena decimal del contrato (`"2400.00"`), en COP. */
  readonly price: string;
  readonly durationMonths: number | null;
}

export interface PlanOption {
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly level: number;
  readonly version: number;
  readonly selectable: boolean;
  /** Todas las capacidades del plan, incluidas las heredadas. */
  readonly capabilities: readonly string[];
  /** Capacidades que ningún plan de nivel inferior incluye. */
  readonly ownCapabilities: readonly string[];
  /** Capacidades que ya aporta algún plan de nivel inferior. */
  readonly inheritedCapabilities: readonly string[];
  readonly offers: readonly PlanOffer[];
  /** Tiene ofertas con periodicidad: la persona elige mensual, trimestral o anual. */
  readonly paid: boolean;
}

export interface PlanCatalog {
  readonly catalogVersion: string;
  /** `null` mientras la suscripción gratuita se activa. */
  readonly currentPlanCode: string | null;
  /** Ordenados por nivel. */
  readonly plans: readonly PlanOption[];
}

export interface Subscription {
  readonly status: SubscriptionStatusDto;
  readonly planCode: string | null;
  readonly periodicity: Periodicity | null;
  readonly price: string | null;
  readonly periodStart: string | null;
  readonly periodEnd: string | null;
  /** Se envía como `expected_subscription_version`. */
  readonly version: number | null;
}

export interface MyPlan {
  readonly catalog: PlanCatalog;
  readonly subscription: Subscription;
}

/** Plan y periodicidad que la persona eligió, con la versión que vio. */
export interface PlanChoice {
  readonly planCode: string;
  readonly periodicity: Periodicity;
  readonly expectedVersion: number;
}

export interface ChangeViolation {
  /** Campo sin el prefijo `body.` (p. ej. `periodicity`). */
  readonly field: string;
  readonly issue: string;
}

export type ChangeOutcome =
  | { readonly kind: 'changed'; readonly subscription: Subscription; readonly replayed: boolean }
  | { readonly kind: 'invalid'; readonly violations: readonly ChangeViolation[] }
  | { readonly kind: 'failed'; readonly error: ApiError };

/** Capacidades con nombre en `affiliation.capabilities.*` (ADR-024). */
export const KNOWN_CAPABILITIES: readonly string[] = [
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
  'training.realtime.monitor',
  'devices.measurement.connect',
  'nutrition.session.reminders',
  'services.sports_medicine.access',
  'services.virtual_sessions.schedule',
];

/**
 * Clave i18n del nombre de una capacidad, o `null` si el catálogo trae una que la
 * web aún no conoce (se muestra su código, nunca se oculta).
 */
export function capabilityKey(code: string): string | null {
  return KNOWN_CAPABILITIES.includes(code)
    ? `affiliation.capabilities.${code.replaceAll('.', '_')}`
    : null;
}

/**
 * Catálogo ordenado por nivel. Las capacidades heredadas son las que aporta algún
 * plan de nivel inferior; se comparan conjuntos de capacidades, nunca nombres de
 * plan (CA8).
 */
export function toCatalog(response: PlansResponseDto): PlanCatalog {
  const plans = [...response.plans].sort((a, b) => a.level - b.level);
  return {
    catalogVersion: response.catalog_version,
    currentPlanCode: response.current_plan_code,
    plans: plans.map((plan) => toPlanOption(plan, plans)),
  };
}

function toPlanOption(plan: PlanDto, all: readonly PlanDto[]): PlanOption {
  const lower = new Set(
    all.filter((other) => other.level < plan.level).flatMap((other) => other.capabilities),
  );
  return {
    code: plan.plan_code,
    name: plan.name,
    description: plan.description,
    level: plan.level,
    version: plan.version,
    selectable: plan.selectable,
    capabilities: plan.capabilities,
    ownCapabilities: plan.capabilities.filter((capability) => !lower.has(capability)),
    inheritedCapabilities: plan.capabilities.filter((capability) => lower.has(capability)),
    offers: plan.offers.map((offer) => ({
      periodicity: offer.periodicity,
      price: offer.price,
      durationMonths: offer.duration_months,
    })),
    paid: plan.offers.some((offer) => offer.periodicity !== 'NONE'),
  };
}

export function toSubscription(response: SubscriptionResponseDto): Subscription {
  return {
    status: response.status,
    planCode: response.plan_code,
    periodicity: response.periodicity,
    price: response.price,
    periodStart: response.period_start,
    periodEnd: response.period_end,
    version: response.version,
  };
}

/** Cuerpo de `POST /v1/me/subscription/changes`, sin propiedades adicionales. */
export function toChangeRequest(choice: PlanChoice): SubscriptionChangeRequestDto {
  return {
    plan_code: choice.planCode,
    periodicity: choice.periodicity,
    expected_subscription_version: choice.expectedVersion,
  };
}

/**
 * Periodicidades que se ofrecen al elegir el plan: las de sus ofertas pagas o,
 * en un plan sin costo, la única que trae (`NONE`).
 */
export function choosablePeriodicities(plan: PlanOption): Periodicity[] {
  return plan.paid
    ? plan.offers.filter((offer) => offer.periodicity !== 'NONE').map((offer) => offer.periodicity)
    : plan.offers.map((offer) => offer.periodicity);
}

/**
 * El plan admite un cambio desde la suscripción vigente: es seleccionable y
 * ofrece alguna periodicidad distinta de la actual. Solo evita una solicitud
 * inútil; el backend sigue respondiendo `409 subscription_unchanged`.
 */
export function canChoose(plan: PlanOption, subscription: Subscription): boolean {
  if (!plan.selectable || subscription.status !== 'ACTIVE') {
    return false;
  }
  return (
    plan.code !== subscription.planCode ||
    choosablePeriodicities(plan).some((periodicity) => periodicity !== subscription.periodicity)
  );
}

/** Capacidades que se ganan y se pierden al pasar del plan actual al elegido. */
export function capabilityChanges(
  current: PlanOption | null,
  target: PlanOption,
): { gained: string[]; lost: string[] } {
  const before = new Set(current?.capabilities ?? []);
  const after = new Set(target.capabilities);
  return {
    gained: target.capabilities.filter((capability) => !before.has(capability)),
    lost: (current?.capabilities ?? []).filter((capability) => !after.has(capability)),
  };
}

/**
 * Importe en pesos colombianos (`es-CO`) desde la cadena decimal del contrato,
 * de 0 a 2 decimales. Solo cambia la presentación: el dato es el del backend.
 */
export function formatCop(amount: string, locale = 'es-CO'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(amount));
}
