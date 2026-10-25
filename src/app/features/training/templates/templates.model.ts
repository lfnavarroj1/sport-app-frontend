import { ApiError } from '../../../core/api/api-error';
import {
  PublishTemplateRequestDto,
  TemplateDayDto,
  TemplateGoalDto,
  TemplateLevelDto,
  TemplateResponseDto,
  TemplateSportDto,
  TemplateStatusDto,
} from '../../../core/api/bff-web/training-templates.api';

/**
 * Modelo de pantalla de las plantillas de plan del profesional (HU028, ADR-041).
 * Transforma el transporte sin reglas del dominio: la validez de la plantilla, la
 * propiedad y la versión las decide el backend. Una plantilla no es un plan
 * asignado (HU010): no tiene deportista ni fechas.
 */

export type TemplateSport = TemplateSportDto;
export type TemplateGoal = TemplateGoalDto;
export type TemplateLevel = TemplateLevelDto;
export type TemplateDay = TemplateDayDto;
export type TemplateStatus = TemplateStatusDto;

/** Sesión de la semana tipo, en el orden del profesional. */
export interface WeeklySession {
  readonly dayOfWeek: TemplateDay;
  readonly description: string;
  readonly durationMinutes: number;
}

/** Plantilla propia confirmada por el backend. */
export interface TrainingTemplate {
  readonly id: string;
  readonly title: string;
  readonly objectives: string;
  readonly sport: TemplateSport;
  readonly goal: TemplateGoal;
  readonly level: TemplateLevel;
  readonly durationWeeks: number;
  readonly weeklySessions: readonly WeeklySession[];
  readonly status: TemplateStatus;
  readonly version: number;
  /** Instantes UTC (`Z`). */
  readonly publishedAt: string;
  readonly retiredAt: string | null;
}

/** Una página en el orden del backend (`created_at` y `template_id` descendentes). */
export interface TemplatesPage {
  readonly templates: readonly TrainingTemplate[];
  readonly nextCursor: string | null;
}

/** Plantilla que captura el profesional, ya normalizada para el contrato. */
export interface TemplateDraft {
  readonly title: string;
  readonly objectives: string;
  readonly sport: TemplateSport;
  readonly goal: TemplateGoal;
  readonly level: TemplateLevel;
  readonly durationWeeks: number;
  readonly weeklySessions: readonly WeeklySession[];
}

/** Regla incumplida (`details[{field, issue}]`), sin el prefijo `body.`. */
export interface TemplateViolation {
  readonly field: string;
  readonly issue: string;
}

export type PublishOutcome =
  | {
      readonly kind: 'published';
      readonly template: TrainingTemplate;
      readonly replayed: boolean;
    }
  | { readonly kind: 'invalid'; readonly violations: readonly TemplateViolation[] }
  | { readonly kind: 'failed'; readonly error: ApiError };

export type RetireOutcome =
  | { readonly kind: 'retired'; readonly template: TrainingTemplate }
  /** `409 version_conflict`: `currentVersion` es la vigente, o `null` si no la trae. */
  | { readonly kind: 'conflict'; readonly currentVersion: number | null }
  | { readonly kind: 'failed'; readonly error: ApiError };

export function toTrainingTemplate(dto: TemplateResponseDto): TrainingTemplate {
  return {
    id: dto.template_id,
    title: dto.title,
    objectives: dto.objectives,
    sport: dto.sport,
    goal: dto.goal,
    level: dto.level,
    durationWeeks: dto.duration_weeks,
    weeklySessions: dto.weekly_sessions.map((session) => ({
      dayOfWeek: session.day_of_week,
      description: session.description,
      durationMinutes: session.duration_minutes,
    })),
    status: dto.status,
    version: dto.version,
    publishedAt: dto.published_at,
    retiredAt: dto.retired_at,
  };
}

/** Cuerpo de `POST /v1/training-plan-templates`: sin `professional_id` ni campos adicionales. */
export function toPublishTemplateRequest(draft: TemplateDraft): PublishTemplateRequestDto {
  return {
    title: draft.title,
    objectives: draft.objectives,
    sport: draft.sport,
    goal: draft.goal,
    level: draft.level,
    duration_weeks: draft.durationWeeks,
    weekly_sessions: draft.weeklySessions.map((session) => ({
      day_of_week: session.dayOfWeek,
      description: session.description,
      duration_minutes: session.durationMinutes,
    })),
  };
}

/** Controles del formulario de la plantilla que pueden recibir una regla del backend. */
export type TemplateControl = 'title' | 'objectives' | 'sport' | 'goal' | 'level' | 'durationWeeks';

/** Controles de una sesión semanal. */
export type SessionControl = 'dayOfWeek' | 'description' | 'durationMinutes';

/** Dónde se marca una regla de `POST /v1/training-plan-templates` en el formulario. */
export type TemplateTarget =
  | { readonly kind: 'field'; readonly control: TemplateControl }
  /** Una sesión (`weekly_sessions.1.duration_minutes`); `control` es `null` si la regla es de la sesión. */
  | { readonly kind: 'session'; readonly index: number; readonly control: SessionControl | null }
  /** La lista completa de sesiones semanales. */
  | { readonly kind: 'sessions' }
  /** Sin control (`Idempotency-Key`, `professional_id` o sin campo): solo el resumen. */
  | { readonly kind: 'none' };

const FIELD_CONTROLS: Readonly<Record<string, TemplateControl>> = {
  title: 'title',
  objectives: 'objectives',
  sport: 'sport',
  goal: 'goal',
  level: 'level',
  duration_weeks: 'durationWeeks',
};

const SESSION_CONTROLS: Readonly<Record<string, SessionControl>> = {
  day_of_week: 'dayOfWeek',
  description: 'description',
  duration_minutes: 'durationMinutes',
};

/**
 * El servicio informa la sesión como `weekly_sessions.1.campo` (ubicación de la
 * validación); también se acepta `weekly_sessions[1].campo`.
 */
const SESSION_PATH = /^weekly_sessions(?:\.(\d+)|\[(\d+)\])(?:\.([a-z_]+))?$/;

/** Ubica la ruta de `details[].field` (sin `body.`) en el formulario. */
export function templateTarget(field: string): TemplateTarget {
  const session = SESSION_PATH.exec(field);
  if (session) {
    const name = session[3];
    if (name !== undefined && !Object.hasOwn(SESSION_CONTROLS, name)) {
      return { kind: 'none' };
    }
    return {
      kind: 'session',
      index: Number(session[1] ?? session[2]),
      control: name === undefined ? null : SESSION_CONTROLS[name],
    };
  }
  if (field === 'weekly_sessions') {
    return { kind: 'sessions' };
  }
  return Object.hasOwn(FIELD_CONTROLS, field)
    ? { kind: 'field', control: FIELD_CONTROLS[field] }
    : { kind: 'none' };
}

/**
 * Motivos que el cliente sabe explicar: los del servicio y los de la validación de
 * forma, agrupados por su significado. Otro motivo usa un texto genérico.
 */
const ISSUE_GROUPS: Readonly<Record<string, string>> = {
  missing: 'required',
  required: 'required',
  invalid_length: 'invalid_length',
  string_too_short: 'invalid_length',
  string_too_long: 'invalid_length',
  out_of_range: 'out_of_range',
  greater_than_equal: 'out_of_range',
  less_than_equal: 'out_of_range',
  too_short: 'out_of_range',
  too_long: 'out_of_range',
  enum: 'unknown_value',
  unknown_value: 'unknown_value',
  int_type: 'not_integer',
  extra_forbidden: 'field_not_allowed',
  field_not_allowed: 'field_not_allowed',
};

export function templateIssueKey(issue: string): string {
  const group = Object.hasOwn(ISSUE_GROUPS, issue) ? ISSUE_GROUPS[issue] : 'unknown';
  return `training.templates.issues.${group}`;
}

/** Texto del campo afectado para el resumen («Sesión 2 (duración)»). */
export function templateFieldText(field: string): {
  readonly key: string;
  readonly params: Readonly<Record<string, unknown>>;
} {
  const target = templateTarget(field);
  switch (target.kind) {
    case 'field':
      return { key: `training.templates.fields.${target.control}`, params: {} };
    case 'session':
      return {
        key: `training.templates.violationFields.session${target.control === null ? '' : capitalize(target.control)}`,
        params: { n: target.index + 1 },
      };
    case 'sessions':
      return { key: 'training.templates.fields.weeklySessions', params: {} };
    case 'none':
      return { key: 'training.templates.violationFields.request', params: {} };
  }
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Minutos totales de la semana tipo, para el resumen de la plantilla. */
export function weeklyMinutes(sessions: readonly WeeklySession[]): number {
  return sessions.reduce((total, session) => total + session.durationMinutes, 0);
}
