import { PLAN_RULE_ISSUES, PlanRuleViolation } from './plan-authoring.model';

export interface TranslatedText {
  readonly key: string;
  readonly params: Readonly<Record<string, unknown>>;
}

/** Texto localizable de una regla incumplida: campo afectado y motivo. */
export interface ViolationMessage {
  readonly field: TranslatedText;
  readonly rule: TranslatedText;
}

export type PlanControl = 'athleteEmail' | 'title' | 'startDate' | 'endDate';
export type SessionField = 'scheduledDate' | 'sport' | 'durationMinutes' | 'intensityRpe';

/** Ubicación de una regla incumplida en el formulario del editor. */
export type ViolationTarget =
  | { readonly control: PlanControl }
  | { readonly control: 'objective'; readonly index: number }
  | { readonly control: 'session'; readonly index: number; readonly field: SessionField }
  | { readonly control: null };

const PLAN_FIELDS: Readonly<Record<string, PlanControl>> = {
  athlete_email: 'athleteEmail',
  title: 'title',
  start_date: 'startDate',
  end_date: 'endDate',
};

const SESSION_FIELDS: Readonly<Record<string, SessionField>> = {
  scheduled_date: 'scheduledDate',
  sport: 'sport',
  duration_minutes: 'durationMinutes',
  intensity_rpe: 'intensityRpe',
};

const KNOWN_ISSUES: readonly string[] = PLAN_RULE_ISSUES;

/** Control del formulario al que corresponde la ruta informada por el backend. */
export function violationTarget(path: string): ViolationTarget {
  const [head, index, field, ...rest] = path.split('.');
  const position = Number(index);
  if (rest.length > 0) {
    return { control: null };
  }
  if (PLAN_FIELDS[head] && index === undefined) {
    return { control: PLAN_FIELDS[head] };
  }
  if (head === 'objectives' && Number.isInteger(position) && field === undefined) {
    return { control: 'objective', index: position };
  }
  if (head === 'sessions' && Number.isInteger(position) && SESSION_FIELDS[field]) {
    return { control: 'session', index: position, field: SESSION_FIELDS[field] };
  }
  return { control: null };
}

/** Claves i18n para presentar la regla; las posiciones se muestran desde 1. */
export function violationMessage(violation: PlanRuleViolation): ViolationMessage {
  return { field: fieldText(violation.path), rule: ruleText(violation.issue) };
}

/** Un motivo que el cliente no conoce se informa con un texto genérico. */
export function ruleText(issue: string): TranslatedText {
  const known = KNOWN_ISSUES.includes(issue);
  return { key: `training.plan.rules.${known ? issue : 'unknown'}`, params: {} };
}

function fieldText(path: string): TranslatedText {
  const target = violationTarget(path);
  switch (target.control) {
    case 'objective':
      return { key: 'training.plan.rules.fieldObjective', params: { n: target.index + 1 } };
    case 'session':
      return {
        key: `training.plan.rules.fieldSession.${target.field}`,
        params: { n: target.index + 1 },
      };
    case null: {
      const head = path.split('.')[0];
      const list = head === 'objectives' || head === 'sessions';
      return {
        key: list ? `training.plan.fields.${head}` : 'training.plan.rules.fieldPlan',
        params: {},
      };
    }
    default:
      return { key: `training.plan.fields.${target.control}`, params: {} };
  }
}
