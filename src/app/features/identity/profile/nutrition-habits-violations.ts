import { KNOWN_PROFILE_ISSUES, ProfileViolation } from './profile.model';

/** Controles del formulario de hábitos alimenticios (HU009). */
export type NutritionHabitsControl =
  'consent' | 'dietPattern' | 'restrictions' | 'allergies' | 'mealsPerDay' | 'hydration';

/** Ruta de `details[].field` (ADR-035) → control que la representa. */
const CONTROLS_BY_FIELD: Readonly<Record<string, NutritionHabitsControl>> = {
  consent: 'consent',
  'consent.version': 'consent',
  diet_pattern: 'dietPattern',
  restrictions: 'restrictions',
  allergies: 'allergies',
  meals_per_day: 'mealsPerDay',
  hydration_liters_per_day: 'hydration',
};

/** Las listas nombran la posición recibida (`allergies[1]`): se marca el grupo completo. */
const LIST_ITEM = /^(restrictions|allergies)\[\d+\]$/;

/** Motivos del consentimiento con un texto propio que indica la acción necesaria. */
const CONSENT_ISSUES: readonly string[] = ['required', 'unsupported_consent_version'];

/**
 * Control donde se marca una regla de `PUT /v1/me/nutrition-habits`; `null` si no
 * corresponde a un campo del formulario (`user_id`, `Idempotency-Key`,
 * `expected_version` o sin campo): esas solo van al resumen.
 */
export function nutritionHabitsControl(field: string): NutritionHabitsControl | null {
  const item = LIST_ITEM.exec(field);
  if (item) {
    return item[1] as NutritionHabitsControl;
  }
  return Object.hasOwn(CONTROLS_BY_FIELD, field) ? CONTROLS_BY_FIELD[field] : null;
}

/**
 * Clave i18n del motivo. En el consentimiento se explica qué debe hacer el
 * deportista; `inconsistent_values` usa el texto genérico (el común habla de la
 * presión arterial) y un motivo desconocido, también.
 */
export function nutritionHabitsIssueKey(violation: ProfileViolation): string {
  const control = nutritionHabitsControl(violation.field);
  if (control === 'consent' && CONSENT_ISSUES.includes(violation.issue)) {
    return `profile.nutrition.consent.issues.${violation.issue}`;
  }
  const known =
    KNOWN_PROFILE_ISSUES.includes(violation.issue) && violation.issue !== 'inconsistent_values';
  return `profile.issues.${known ? violation.issue : 'unknown'}`;
}

/** Clave i18n del campo afectado, para el resumen de reglas incumplidas. */
export function nutritionHabitsFieldKey(violation: ProfileViolation): string {
  const control = nutritionHabitsControl(violation.field);
  return control === null ? 'profile.issues.fieldRequest' : `profile.nutrition.fields.${control}`;
}
