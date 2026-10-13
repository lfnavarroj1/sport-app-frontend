import { ApiError } from '../../../core/api/api-error';
import { PlannedSession, TrainingPlan } from '../training-plan.model';

/** Datos que el profesional captura en el editor (HU010). */
export interface PlanDraft {
  /** Correo exacto del deportista: el BFF lo resuelve; no hay búsqueda parcial. */
  readonly athleteEmail: string;
  readonly title: string;
  readonly objectives: readonly string[];
  readonly startDate: string;
  readonly endDate: string;
  readonly sessions: readonly PlannedSession[];
}

/**
 * Regla incumplida que informa el backend (CA3). `path` es la ruta del campo en
 * la solicitud sin el prefijo `body.` (`end_date`, `sessions.1.scheduled_date`);
 * vacía si el backend no indica el campo.
 */
export interface PlanRuleViolation {
  readonly path: string;
  readonly issue: string;
}

/**
 * Motivos estables de `training_plan_invalid`. El OpenAPI 0.8.0 no los enumera;
 * se toman de `training_management` (`domain/plans/model.py`, backend `67a239d`).
 * Un motivo fuera de esta lista se informa con un texto genérico, nunca se oculta.
 */
export const PLAN_RULE_ISSUES = [
  'invalid_length',
  'invalid_count',
  'end_date_before_start_date',
  'period_too_long',
  'outside_plan_period',
  'out_of_range',
  'too_many_sessions_per_day',
] as const;

/** Resultado del comando de creación, ya traducido desde el contrato. */
export type CreatePlanOutcome =
  | { readonly kind: 'created'; readonly plan: TrainingPlan; readonly replayed: boolean }
  | { readonly kind: 'invalid'; readonly violations: readonly PlanRuleViolation[] }
  /** Correo inexistente o deportista sin autorización: el BFF no los distingue (CA2). */
  | { readonly kind: 'athlete_not_authorized' }
  | { readonly kind: 'failed'; readonly error: ApiError };
