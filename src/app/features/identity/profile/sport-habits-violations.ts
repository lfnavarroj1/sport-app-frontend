import { KNOWN_PROFILE_ISSUES, ProfileViolation } from './profile.model';

/** Controles de una fila de deporte del formulario de hábitos (HU006). */
export type SportHabitControl =
  | 'sport'
  | 'frequencyPerWeek'
  | 'sessionDurationMinutes'
  | 'intensity'
  | 'level'
  | 'yearsPracticing';

/**
 * Dónde se marca una regla de `PUT /v1/me/sport-habits`. Las listas nombran la
 * posición recibida (`sports[1].sport`, `availability.days[0]`): como el cliente
 * envía los deportes en el orden de las filas, `index` es la fila del formulario.
 */
export type SportHabitsTarget =
  | { readonly kind: 'sports' }
  | {
      readonly kind: 'sport';
      readonly index: number;
      /** `null` si la regla es de la fila completa (`sports[1]`) o de un campo ajeno. */
      readonly control: SportHabitControl | null;
    }
  | { readonly kind: 'days' }
  | { readonly kind: 'timeSlots' }
  /** `availability` sin más detalle: se marcan los días y las franjas. */
  | { readonly kind: 'availability' }
  | { readonly kind: 'primaryGoal' }
  /** Sin control en el formulario (`user_id`, `Idempotency-Key` o sin campo): solo el resumen. */
  | { readonly kind: 'none' };

/** Texto i18n con sus parámetros. */
export interface TranslatedText {
  readonly key: string;
  readonly params: Readonly<Record<string, unknown>>;
}

const SPORT_CONTROLS: Readonly<Record<string, SportHabitControl>> = {
  sport: 'sport',
  frequency_per_week: 'frequencyPerWeek',
  session_duration_minutes: 'sessionDurationMinutes',
  intensity: 'intensity',
  level: 'level',
  years_practicing: 'yearsPracticing',
};

const SPORT_PATH = /^sports\[(\d+)\](?:\.([a-z_]+))?$/;
const DAYS_PATH = /^availability\.days(?:\[\d+\])?$/;
const TIME_SLOTS_PATH = /^availability\.time_slots(?:\[\d+\])?$/;

/** Ubica la ruta de `details[].field` (sin el prefijo `body.`) en el formulario. */
export function sportHabitsTarget(field: string): SportHabitsTarget {
  if (field === 'sports') {
    return { kind: 'sports' };
  }
  const sport = SPORT_PATH.exec(field);
  if (sport) {
    const name = sport[2];
    return {
      kind: 'sport',
      index: Number(sport[1]),
      control:
        name !== undefined && Object.hasOwn(SPORT_CONTROLS, name) ? SPORT_CONTROLS[name] : null,
    };
  }
  if (DAYS_PATH.test(field)) {
    return { kind: 'days' };
  }
  if (TIME_SLOTS_PATH.test(field)) {
    return { kind: 'timeSlots' };
  }
  if (field === 'availability') {
    return { kind: 'availability' };
  }
  if (field === 'primary_goal') {
    return { kind: 'primaryGoal' };
  }
  return { kind: 'none' };
}

/**
 * Clave i18n del motivo. Un deporte repetido y una lista de más de cinco
 * deportes explican qué hacer; los demás usan el catálogo común del perfil y un
 * motivo desconocido, el texto genérico.
 */
export function sportHabitsIssueKey(violation: ProfileViolation): string {
  const target = sportHabitsTarget(violation.field);
  if (
    target.kind === 'sport' &&
    target.control === 'sport' &&
    violation.issue === 'duplicate_value'
  ) {
    return 'profile.habits.issues.duplicateSport';
  }
  if (target.kind === 'sports' && violation.issue === 'too_many_items') {
    return 'profile.habits.issues.tooManySports';
  }
  return `profile.issues.${KNOWN_PROFILE_ISSUES.includes(violation.issue) ? violation.issue : 'unknown'}`;
}

/** Nombre del campo afectado para el resumen de reglas incumplidas («Deporte 2: frecuencia»). */
export function sportHabitsFieldText(violation: ProfileViolation): TranslatedText {
  const target = sportHabitsTarget(violation.field);
  switch (target.kind) {
    case 'sport':
      return {
        key: `profile.habits.violationFields.${target.control ?? 'row'}`,
        params: { n: target.index + 1 },
      };
    case 'none':
      return { key: 'profile.issues.fieldRequest', params: {} };
    default:
      return { key: `profile.habits.violationFields.${target.kind}`, params: {} };
  }
}
