import { KNOWN_PROFILE_ISSUES, ProfileViolation } from './profile.model';

/** Controles del formulario demográfico de HU005. */
export type DemographicControl =
  'birthDate' | 'gender' | 'countryCode' | 'city' | 'maritalStatus' | 'occupation' | 'incomeRange';

/** Controles del formulario fisiológico de HU005. */
export type PhysiologicalControl =
  | 'consent'
  | 'measuredAt'
  | 'weightKg'
  | 'heightCm'
  | 'restingHeartRateBpm'
  | 'systolic'
  | 'diastolic'
  | 'bodyTemperatureC';

export type ProfileControl = DemographicControl | PhysiologicalControl;

const DEMOGRAPHIC_CONTROLS: readonly ProfileControl[] = [
  'birthDate',
  'gender',
  'countryCode',
  'city',
  'maritalStatus',
  'occupation',
  'incomeRange',
];

/** Motivos del consentimiento con un texto propio que indica la acción necesaria (CA3). */
const CONSENT_ISSUES: readonly string[] = ['required', 'unsupported_consent_version'];

/** Ruta de `details[].field` (ADR-034) → controles que la representan. */
const CONTROLS_BY_FIELD: Readonly<Record<string, readonly ProfileControl[]>> = {
  birth_date: ['birthDate'],
  gender: ['gender'],
  country_code: ['countryCode'],
  city: ['city'],
  marital_status: ['maritalStatus'],
  occupation: ['occupation'],
  income_range: ['incomeRange'],
  consent: ['consent'],
  'consent.version': ['consent'],
  measured_at: ['measuredAt'],
  weight_kg: ['weightKg'],
  height_cm: ['heightCm'],
  resting_heart_rate_bpm: ['restingHeartRateBpm'],
  blood_pressure: ['systolic', 'diastolic'],
  'blood_pressure.systolic_mmhg': ['systolic'],
  'blood_pressure.diastolic_mmhg': ['diastolic'],
  body_temperature_c: ['bodyTemperatureC'],
};

/**
 * Controles donde se marca la regla; vacío si no corresponde a un campo del
 * formulario (`bmi`, `user_id` o sin campo): esas solo van al resumen.
 */
export function controlsFor(field: string): readonly ProfileControl[] {
  return Object.hasOwn(CONTROLS_BY_FIELD, field) ? CONTROLS_BY_FIELD[field] : [];
}

/**
 * Clave i18n del motivo. En el consentimiento se explica qué debe hacer el
 * deportista; un motivo desconocido usa un texto genérico.
 */
export function issueKey(violation: ProfileViolation): string {
  if (
    controlsFor(violation.field).includes('consent') &&
    CONSENT_ISSUES.includes(violation.issue)
  ) {
    return `profile.physiological.consent.issues.${violation.issue}`;
  }
  return `profile.issues.${KNOWN_PROFILE_ISSUES.includes(violation.issue) ? violation.issue : 'unknown'}`;
}

/** Clave i18n del campo afectado, para el resumen de reglas incumplidas. */
export function fieldKey(violation: ProfileViolation): string {
  if (violation.field === 'blood_pressure') {
    return 'profile.physiological.fields.bloodPressure';
  }
  const [control] = controlsFor(violation.field);
  if (control === undefined) {
    return 'profile.issues.fieldRequest';
  }
  return DEMOGRAPHIC_CONTROLS.includes(control)
    ? `profile.demographic.fields.${control}`
    : `profile.physiological.fields.${control}`;
}
