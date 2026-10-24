/**
 * Simulador del perfil del deportista (HU005 y HU006) derivado del contrato
 * bff-web 0.19.0 (`src/app/core/api/contracts/bff-web.openapi.json`) y de los
 * ejemplos de ADR-034: `GET /v1/me/profile`, `PUT /v1/me/demographic-profile`,
 * `PUT /v1/me/physiological-profile` y `PUT /v1/me/sport-habits`. Lo usan las pruebas unitarias y
 * Playwright; `profile.contract.spec.ts` valida cada respuesta contra el esquema
 * del contrato. Datos sintéticos.
 *
 * Archivo sin dependencias de Angular para poder importarlo desde Playwright.
 */
import { SimulatedResponse } from './register-user.fixtures';

export const PROFILE_PATH = '/v1/me/profile';
export const DEMOGRAPHIC_PROFILE_PATH = '/v1/me/demographic-profile';
export const PHYSIOLOGICAL_PROFILE_PATH = '/v1/me/physiological-profile';
export const SPORT_HABITS_PATH = '/v1/me/sport-habits';

/** Mismo deportista que la sesión simulada de `create-session.fixtures.ts`. */
export const SIMULATED_PROFILE_USER_ID = '0b9f6c1e-3d2a-4f5b-8c7d-1e2f3a4b5c6d';
/**
 * Versión del consentimiento que aceptan las pruebas: la de
 * `public/app-config.json` (`healthDataConsentVersion`) y la del overlay local
 * del backend (`HEALTH_DATA_CONSENT_VERSION`).
 */
export const SIMULATED_HEALTH_CONSENT_VERSION = 'local-dev';
const CORRELATION_ID = '7c1e4a9b-2d3f-4b5c-8e6f-9a0b1c2d3e4f';

/** Solicitud demográfica de creación del ejemplo de ADR-034 (sin `expected_version`). */
export const VALID_DEMOGRAPHIC_REQUEST = {
  birth_date: '1992-04-18',
  gender: 'FEMALE',
  country_code: 'CO',
  city: 'Bogotá',
  marital_status: 'SINGLE',
  occupation: 'Ingeniera',
  income_range: '2_4_SMMLV',
} as const;

/** Solicitud fisiológica de creación del ejemplo de ADR-034 (sin `expected_version`). */
export const VALID_PHYSIOLOGICAL_REQUEST = {
  consent: { version: SIMULATED_HEALTH_CONSENT_VERSION },
  measured_at: '2026-10-12T13:00:00Z',
  weight_kg: '68.5',
  height_cm: 172,
  resting_heart_rate_bpm: 58,
  blood_pressure: { systolic_mmhg: 118, diastolic_mmhg: 76 },
  body_temperature_c: '36.6',
} as const;

/** Sección demográfica confirmada en la versión 1. */
export const DEMOGRAPHIC_SECTION = {
  version: 1,
  birth_date: VALID_DEMOGRAPHIC_REQUEST.birth_date,
  gender: VALID_DEMOGRAPHIC_REQUEST.gender,
  country_code: VALID_DEMOGRAPHIC_REQUEST.country_code,
  city: VALID_DEMOGRAPHIC_REQUEST.city,
  marital_status: VALID_DEMOGRAPHIC_REQUEST.marital_status,
  occupation: VALID_DEMOGRAPHIC_REQUEST.occupation,
  income_range: VALID_DEMOGRAPHIC_REQUEST.income_range,
  created_at: '2026-10-12T13:05:00Z',
  updated_at: '2026-10-12T13:05:00Z',
} as const;

/** Sección fisiológica confirmada en la versión 1; `bmi` de ADR-034 (68.5 kg y 172 cm → 23.2). */
export const PHYSIOLOGICAL_SECTION = {
  version: 1,
  consent: { version: SIMULATED_HEALTH_CONSENT_VERSION, accepted_at: '2026-10-12T13:06:00Z' },
  measured_at: VALID_PHYSIOLOGICAL_REQUEST.measured_at,
  weight_kg: VALID_PHYSIOLOGICAL_REQUEST.weight_kg,
  height_cm: VALID_PHYSIOLOGICAL_REQUEST.height_cm,
  bmi: '23.2',
  resting_heart_rate_bpm: VALID_PHYSIOLOGICAL_REQUEST.resting_heart_rate_bpm,
  blood_pressure: VALID_PHYSIOLOGICAL_REQUEST.blood_pressure,
  body_temperature_c: VALID_PHYSIOLOGICAL_REQUEST.body_temperature_c,
  created_at: '2026-10-12T13:06:00Z',
  updated_at: '2026-10-12T13:06:00Z',
} as const;

/**
 * Solicitud de hábitos de creación (HU006), a partir del ejemplo de ADR-034 con
 * un segundo deporte sin años de práctica (sin `expected_version`).
 */
export const VALID_SPORT_HABITS_REQUEST = {
  sports: [
    {
      sport: 'running',
      frequency_per_week: 3,
      session_duration_minutes: 45,
      intensity: 'MODERATE',
      level: 'INTERMEDIATE',
      years_practicing: 4,
    },
    {
      sport: 'swimming',
      frequency_per_week: 1,
      session_duration_minutes: 60,
      intensity: 'LOW',
      level: 'BEGINNER',
      years_practicing: null,
    },
  ],
  availability: { days: ['MON', 'WED', 'SAT'], time_slots: ['MORNING'] },
  primary_goal: 'HEALTH',
} as const;

/** Hábitos confirmados en la versión 1, ya en el orden de los catálogos. */
export const SPORT_HABITS_SECTION = {
  version: 1,
  sports: VALID_SPORT_HABITS_REQUEST.sports,
  availability: VALID_SPORT_HABITS_REQUEST.availability,
  primary_goal: VALID_SPORT_HABITS_REQUEST.primary_goal,
  created_at: '2026-10-12T13:07:00Z',
  updated_at: '2026-10-12T13:07:00Z',
} as const;

/** Respuesta del comando de hábitos (`201` al crear). */
export const SPORT_HABITS_RESPONSE = {
  user_id: SIMULATED_PROFILE_USER_ID,
  ...SPORT_HABITS_SECTION,
};

/** Respuesta del comando demográfico (`201` al crear). */
export const DEMOGRAPHIC_RESPONSE = { user_id: SIMULATED_PROFILE_USER_ID, ...DEMOGRAPHIC_SECTION };
/** Respuesta del comando fisiológico (`201` al crear). */
export const PHYSIOLOGICAL_RESPONSE = {
  user_id: SIMULATED_PROFILE_USER_ID,
  ...PHYSIOLOGICAL_SECTION,
};

/** Perfil sin secciones registradas. */
export const EMPTY_PROFILE = {
  user_id: SIMULATED_PROFILE_USER_ID,
  demographic: null,
  physiological: null,
  sport_habits: null,
  versions: { demographic: null, physiological: null, sport_habits: null },
  projected_at: null,
} as const;

/** Perfil con ambas secciones proyectadas en la versión 1. */
export const FULL_PROFILE = {
  user_id: SIMULATED_PROFILE_USER_ID,
  demographic: DEMOGRAPHIC_SECTION,
  physiological: PHYSIOLOGICAL_SECTION,
  sport_habits: null,
  versions: { demographic: 1, physiological: 1, sport_habits: null },
  projected_at: '2026-10-12T13:06:01Z',
} as const;

/** Perfil con las tres secciones proyectadas en la versión 1 (HU005 y HU006). */
export const PROFILE_WITH_SPORT_HABITS = {
  ...FULL_PROFILE,
  sport_habits: SPORT_HABITS_SECTION,
  versions: { demographic: 1, physiological: 1, sport_habits: 1 },
  projected_at: '2026-10-12T13:07:01Z',
} as const;

function error(
  status: number,
  code: string,
  message: string,
  details: readonly { field: string | null; issue: string }[] = [],
) {
  return { status, body: { code, message, correlation_id: CORRELATION_ID, details } } as const;
}

export const GET_PROFILE_RESPONSES = {
  empty: { status: 200, body: EMPTY_PROFILE },
  full: { status: 200, body: FULL_PROFILE },
  withSportHabits: { status: 200, body: PROFILE_WITH_SPORT_HABITS },
  invalidAccessToken: error(401, 'invalid_access_token', 'La sesión no es válida.'),
  permissionRequired: error(403, 'permission_required', 'Solo el deportista tiene perfil.'),
  upstreamUnavailable: error(503, 'upstream_unavailable', 'El servicio no está disponible.'),
  upstreamTimeout: error(504, 'upstream_timeout', 'El servicio tardó demasiado en responder.'),
} as const satisfies Record<string, SimulatedResponse>;

/** Errores comunes a los comandos de HU005 y HU006. */
const COMMAND_ERRORS = {
  invalidAccessToken: error(401, 'invalid_access_token', 'La sesión no es válida.'),
  permissionRequired: error(403, 'permission_required', 'Solo el deportista tiene perfil.'),
  /** La sección ya está en la versión 2: el cliente envió una versión anterior. */
  versionConflict: error(409, 'version_conflict', 'La sección cambió.', [
    { field: 'expected_version', issue: '2' },
  ]),
  /** Se envió `expected_version` para una sección que no existe. */
  versionConflictMissing: error(409, 'version_conflict', 'La sección no existe.', [
    { field: 'expected_version', issue: '0' },
  ]),
  idempotencyKeyReused: error(
    409,
    'idempotency_key_reused',
    'La clave de idempotencia ya se usó con otra solicitud.',
  ),
  upstreamUnavailable: error(503, 'upstream_unavailable', 'El servicio no está disponible.'),
  upstreamTimeout: error(504, 'upstream_timeout', 'El servicio tardó demasiado en responder.'),
} as const;

export const DEMOGRAPHIC_RESPONSES = {
  created: { status: 201, body: DEMOGRAPHIC_RESPONSE },
  replaced: {
    status: 200,
    body: {
      ...DEMOGRAPHIC_RESPONSE,
      version: 2,
      city: 'Medellín',
      updated_at: '2026-10-13T08:00:00Z',
    },
  },
  ...COMMAND_ERRORS,
  /** Varias reglas incumplidas a la vez, con campos y motivos de ADR-034. */
  validationError: error(422, 'validation_error', 'La solicitud no es válida.', [
    { field: 'birth_date', issue: 'out_of_range' },
    { field: 'country_code', issue: 'unknown_value' },
    { field: 'user_id', issue: 'field_not_allowed' },
  ]),
} as const satisfies Record<string, SimulatedResponse>;

export const PHYSIOLOGICAL_RESPONSES = {
  created: { status: 201, body: PHYSIOLOGICAL_RESPONSE },
  replaced: {
    status: 200,
    body: {
      ...PHYSIOLOGICAL_RESPONSE,
      version: 2,
      consent: { version: SIMULATED_HEALTH_CONSENT_VERSION, accepted_at: '2026-10-13T08:01:00Z' },
      weight_kg: '70.0',
      bmi: '23.7',
      updated_at: '2026-10-13T08:01:00Z',
    },
  },
  ...COMMAND_ERRORS,
  /** Valor fuera de rango, presión inconsistente y `bmi` enviado por el cliente. */
  validationError: error(422, 'validation_error', 'La solicitud no es válida.', [
    { field: 'weight_kg', issue: 'out_of_range' },
    { field: 'blood_pressure', issue: 'inconsistent_values' },
    { field: 'bmi', issue: 'field_not_allowed' },
  ]),
  /** Consentimiento con una versión distinta de la vigente (CA3). */
  unsupportedConsentVersion: error(422, 'validation_error', 'La solicitud no es válida.', [
    { field: 'consent.version', issue: 'unsupported_consent_version' },
  ]),
  /** Consentimiento ausente (CA3). */
  consentRequired: error(422, 'validation_error', 'La solicitud no es válida.', [
    { field: 'consent.version', issue: 'required' },
  ]),
} as const satisfies Record<string, SimulatedResponse>;

export const SPORT_HABITS_RESPONSES = {
  created: { status: 201, body: SPORT_HABITS_RESPONSE },
  replaced: {
    status: 200,
    body: {
      ...SPORT_HABITS_RESPONSE,
      version: 2,
      sports: [{ ...VALID_SPORT_HABITS_REQUEST.sports[0], frequency_per_week: 4 }],
      availability: { days: ['TUE', 'THU'], time_slots: ['MORNING', 'EVENING'] },
      primary_goal: null,
      updated_at: '2026-10-13T08:02:00Z',
    },
  },
  ...COMMAND_ERRORS,
  /** Deporte repetido en la segunda fila, día repetido y frecuencia fuera de rango (CA2). */
  validationError: error(422, 'validation_error', 'La solicitud no es válida.', [
    { field: 'sports[1].sport', issue: 'duplicate_value' },
    { field: 'sports[0].frequency_per_week', issue: 'out_of_range' },
    { field: 'availability.days[1]', issue: 'duplicate_value' },
  ]),
  /** Más de cinco deportes (CA2). */
  tooManySports: error(422, 'validation_error', 'La solicitud no es válida.', [
    { field: 'sports', issue: 'too_many_items' },
  ]),
} as const satisfies Record<string, SimulatedResponse>;

export const SIMULATED_PROFILE_CORRELATION_ID = CORRELATION_ID;
