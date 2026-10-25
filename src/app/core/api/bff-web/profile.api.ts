import { HttpClient, HttpHeaders, HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { BffWebUrl } from '../bff-web-url';
import { SPORTS, SportDto } from './training.api';

/**
 * Transporte del perfil del deportista (HU005 y HU006, ADR-034; HU008 y HU009,
 * ADR-035) del contrato bff-web 0.30.0 (ver `contract.ts`): `GET /v1/me/profile`
 * (`get_profile_v1_me_profile_get`), `PUT /v1/me/demographic-profile`
 * (`put_demographic_v1_me_demographic_profile_put`),
 * `PUT /v1/me/physiological-profile`
 * (`put_physiological_v1_me_physiological_profile_put`) y
 * `PUT /v1/me/sport-habits` (`put_sport_habits_v1_me_sport_habits_put`),
 * `PATCH /v1/me/sport-habits` (`patch_sport_habits_v1_me_sport_habits_patch`) y
 * `PUT /v1/me/nutrition-habits` (`put_nutrition_habits_v1_me_nutrition_habits_put`). Solo
 * `athlete`; la identidad sale del token y el cuerpo nunca lleva `user_id` ni
 * `bmi`. Estos tipos son del transporte: la interfaz los transforma antes de
 * usarlos.
 */

/** Enumeración `gender`. */
export const GENDERS = ['FEMALE', 'MALE', 'NON_BINARY', 'PREFER_NOT_TO_SAY'] as const;
export type GenderDto = (typeof GENDERS)[number];

/** Enumeración `marital_status` (opcional). */
export const MARITAL_STATUSES = [
  'SINGLE',
  'MARRIED',
  'DOMESTIC_PARTNERSHIP',
  'DIVORCED',
  'WIDOWED',
  'PREFER_NOT_TO_SAY',
] as const;
export type MaritalStatusDto = (typeof MARITAL_STATUSES)[number];

/** Enumeración `income_range` (opcional). */
export const INCOME_RANGES = [
  'LT_1_SMMLV',
  '1_2_SMMLV',
  '2_4_SMMLV',
  'GT_4_SMMLV',
  'PREFER_NOT_TO_SAY',
] as const;
export type IncomeRangeDto = (typeof INCOME_RANGES)[number];

/**
 * Esquema `DemographicProfileRequest`. `expected_version` se omite al crear y
 * es obligatorio, igual a la versión vigente, al reemplazar.
 */
export interface DemographicProfileRequestDto {
  readonly expected_version?: number;
  /** Fecha ISO (`YYYY-MM-DD`). */
  readonly birth_date: string;
  readonly gender: GenderDto;
  /** ISO 3166-1 alfa-2 en mayúsculas. */
  readonly country_code: string;
  readonly city: string;
  readonly marital_status: MaritalStatusDto | null;
  readonly occupation: string | null;
  readonly income_range: IncomeRangeDto | null;
}

/** Esquema `DemographicProfileSection`: sección normalizada, instantes en UTC (`Z`). */
export interface DemographicProfileSectionDto {
  readonly version: number;
  readonly birth_date: string;
  readonly gender: GenderDto;
  readonly country_code: string;
  readonly city: string;
  readonly marital_status: MaritalStatusDto | null;
  readonly occupation: string | null;
  readonly income_range: IncomeRangeDto | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/** Esquema `DemographicProfileResponse`: la sección con el `user_id` del token. */
export interface DemographicProfileResponseDto extends DemographicProfileSectionDto {
  readonly user_id: string;
}

/** Esquema `BloodPressure`, en mmHg. */
export interface BloodPressureDto {
  readonly systolic_mmhg: number;
  readonly diastolic_mmhg: number;
}

/**
 * Esquema `PhysiologicalProfileRequest`. Los decimales viajan como cadena;
 * `consent.version` debe ser la versión vigente (`HEALTH_DATA_CONSENT_VERSION`).
 */
export interface PhysiologicalProfileRequestDto {
  readonly expected_version?: number;
  readonly consent: { readonly version: string };
  /** UTC con sufijo `Z` y precisión de segundos. */
  readonly measured_at: string;
  readonly weight_kg: string;
  readonly height_cm: number;
  readonly resting_heart_rate_bpm: number | null;
  readonly blood_pressure: BloodPressureDto | null;
  readonly body_temperature_c: string | null;
}

/** Esquema `HealthConsent`. */
export interface HealthConsentDto {
  readonly version: string;
  /** Instante del registro del consentimiento, en UTC (`Z`). */
  readonly accepted_at: string;
}

/** Esquema `PhysiologicalProfileSection`: sin rangos clínicos ni etiquetas de riesgo. */
export interface PhysiologicalProfileSectionDto {
  readonly version: number;
  readonly consent: HealthConsentDto;
  readonly measured_at: string;
  readonly weight_kg: string;
  readonly height_cm: number;
  /** Calculado por el backend, un decimal. */
  readonly bmi: string;
  readonly resting_heart_rate_bpm: number | null;
  readonly blood_pressure: BloodPressureDto | null;
  readonly body_temperature_c: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/** Esquema `PhysiologicalProfileResponse`: la sección con el `user_id` del token. */
export interface PhysiologicalProfileResponseDto extends PhysiologicalProfileSectionDto {
  readonly user_id: string;
}

/** Enumeración `sport` de `SportHabit`: el catálogo de deportes de HU010. */
export const HABIT_SPORTS = SPORTS;
export type HabitSportDto = SportDto;

/** Enumeración `intensity` de `SportHabit`. */
export const HABIT_INTENSITIES = ['LOW', 'MODERATE', 'HIGH'] as const;
export type HabitIntensityDto = (typeof HABIT_INTENSITIES)[number];

/** Enumeración `level` de `SportHabit`. */
export const HABIT_LEVELS = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'] as const;
export type HabitLevelDto = (typeof HABIT_LEVELS)[number];

/** Enumeración `availability.days`, en el orden del catálogo (`MON`…`SUN`). */
export const WEEK_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
export type WeekDayDto = (typeof WEEK_DAYS)[number];

/** Enumeración `availability.time_slots`, en el orden del catálogo. */
export const TIME_SLOTS = ['MORNING', 'AFTERNOON', 'EVENING', 'NIGHT'] as const;
export type TimeSlotDto = (typeof TIME_SLOTS)[number];

/** Enumeración `primary_goal` (opcional). */
export const PRIMARY_GOALS = [
  'HEALTH',
  'PERFORMANCE',
  'WEIGHT_MANAGEMENT',
  'RECREATION',
  'COMPETITION',
] as const;
export type PrimaryGoalDto = (typeof PRIMARY_GOALS)[number];

/** Esquema `SportHabit` de la solicitud y `SportHabitView` de las respuestas. */
export interface SportHabitDto {
  readonly sport: HabitSportDto;
  readonly frequency_per_week: number;
  readonly session_duration_minutes: number;
  readonly intensity: HabitIntensityDto;
  readonly level: HabitLevelDto;
  readonly years_practicing: number | null;
}

/** Esquema `SportAvailability` de la solicitud y `SportAvailabilityView` de las respuestas. */
export interface SportAvailabilityDto {
  readonly days: readonly WeekDayDto[];
  readonly time_slots: readonly TimeSlotDto[];
}

/**
 * Esquema `SportHabitsRequest`: hábitos completos (`PUT` de reemplazo).
 * `expected_version` se omite al crear y es obligatorio, igual a la versión
 * vigente, al reemplazar. Los errores de una lista nombran la posición recibida
 * (`sports[1].sport`, `availability.days[0]`).
 */
export interface SportHabitsRequestDto {
  readonly expected_version?: number;
  readonly sports: readonly SportHabitDto[];
  readonly availability: SportAvailabilityDto;
  readonly primary_goal: PrimaryGoalDto | null;
}

/**
 * Esquema `SportHabitsPatchRequest` (HU008, ADR-035): una o más secciones; cada
 * sección enviada reemplaza completa a la vigente y las no enviadas se conservan.
 * `expected_version` es obligatoria; `primary_goal: null` borra el objetivo. Sin
 * secciones el backend responde `422 required`, por eso el cliente no lo envía.
 */
export interface SportHabitsPatchRequestDto {
  readonly expected_version: number;
  readonly sports?: readonly SportHabitDto[];
  readonly availability?: SportAvailabilityDto;
  readonly primary_goal?: PrimaryGoalDto | null;
}

/**
 * Esquema `SportHabitsSection`: hábitos normalizados (deportes, días y franjas
 * en el orden de su catálogo), instantes en UTC (`Z`).
 */
export interface SportHabitsSectionDto {
  readonly version: number;
  readonly sports: readonly SportHabitDto[];
  readonly availability: SportAvailabilityDto;
  readonly primary_goal: PrimaryGoalDto | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/** Esquema `SportHabitsResponse`: la sección con el `user_id` del token. */
export interface SportHabitsResponseDto extends SportHabitsSectionDto {
  readonly user_id: string;
}

/** Enumeración `diet_pattern` de los hábitos alimenticios (HU009, ADR-035). */
export const DIET_PATTERNS = [
  'OMNIVORE',
  'VEGETARIAN',
  'VEGAN',
  'PESCATARIAN',
  'FLEXITARIAN',
] as const;
export type DietPatternDto = (typeof DIET_PATTERNS)[number];

/** Enumeración de `restrictions[]`, en el orden del catálogo. */
export const DIET_RESTRICTIONS = [
  'GLUTEN_FREE',
  'LACTOSE_FREE',
  'LOW_SODIUM',
  'LOW_SUGAR',
  'KETO',
  'HALAL',
  'KOSHER',
] as const;
export type DietRestrictionDto = (typeof DIET_RESTRICTIONS)[number];

/** Enumeración de `allergies[]`, en el orden del catálogo. */
export const FOOD_ALLERGIES = [
  'PEANUTS',
  'TREE_NUTS',
  'MILK',
  'EGGS',
  'WHEAT',
  'SOY',
  'FISH',
  'SHELLFISH',
  'SESAME',
] as const;
export type FoodAllergyDto = (typeof FOOD_ALLERGIES)[number];

/**
 * Esquema `NutritionHabitsRequest`: hábitos completos (`PUT` de reemplazo), sin
 * texto libre. `consent.version` debe ser la versión vigente
 * (`HEALTH_DATA_CONSENT_VERSION`). `expected_version` se omite al crear y es
 * obligatorio, igual a la versión vigente, al reemplazar. Los errores de una
 * lista nombran la posición recibida (`allergies[1]`).
 */
export interface NutritionHabitsRequestDto {
  readonly expected_version?: number;
  readonly consent: { readonly version: string };
  readonly diet_pattern: DietPatternDto;
  readonly restrictions: readonly DietRestrictionDto[];
  readonly allergies: readonly FoodAllergyDto[];
  readonly meals_per_day: number;
  /** Cadena decimal con hasta un decimal, de 0.5 a 10.0 litros; `null` si no se indica. */
  readonly hydration_liters_per_day: string | null;
}

/**
 * Esquema `NutritionHabitsSection`: restricciones y alergias en el orden de su
 * catálogo, hidratación con un decimal, instantes en UTC (`Z`). No prescriben ni
 * diagnostican.
 */
export interface NutritionHabitsSectionDto {
  readonly version: number;
  readonly consent: HealthConsentDto;
  readonly diet_pattern: DietPatternDto;
  readonly restrictions: readonly DietRestrictionDto[];
  readonly allergies: readonly FoodAllergyDto[];
  readonly meals_per_day: number;
  readonly hydration_liters_per_day: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/** Esquema `NutritionHabitsResponse`: la sección con el `user_id` del token. */
export interface NutritionHabitsResponseDto extends NutritionHabitsSectionDto {
  readonly user_id: string;
}

/** Esquema `ProfileVersions`. */
export interface ProfileVersionsDto {
  readonly demographic: number | null;
  readonly physiological: number | null;
  readonly sport_habits: number | null;
  readonly nutrition_habits: number | null;
}

/**
 * Esquema `ProfileResponse`: perfil proyectado (consistencia eventual), con
 * `null` en las secciones aún sin datos.
 */
export interface ProfileResponseDto {
  readonly user_id: string;
  readonly demographic: DemographicProfileSectionDto | null;
  readonly physiological: PhysiologicalProfileSectionDto | null;
  readonly sport_habits: SportHabitsSectionDto | null;
  readonly nutrition_habits: NutritionHabitsSectionDto | null;
  readonly versions: ProfileVersionsDto;
  readonly projected_at: string | null;
}

/**
 * Límites del contrato (ADR-034). Los de longitud y enteros están en el
 * esquema; los rangos decimales, la edad y la ventana de `measured_at` en las
 * descripciones de sus campos.
 */
export const PROFILE_LIMITS = {
  cityMin: 2,
  cityMax: 80,
  occupationMin: 2,
  occupationMax: 80,
  ageMin: 13,
  ageMax: 120,
  weightMin: '20.0',
  weightMax: '300.0',
  heightMin: 100,
  heightMax: 250,
  restingHeartRateMin: 30,
  restingHeartRateMax: 220,
  systolicMin: 60,
  systolicMax: 250,
  diastolicMin: 30,
  diastolicMax: 150,
  bodyTemperatureMin: '34.0',
  bodyTemperatureMax: '42.0',
  measuredAtFutureMinutes: 5,
  measuredAtPastDays: 365,
} as const;

/** Límites de `SportHabitsRequest` en el contrato (ADR-034). */
export const SPORT_HABITS_LIMITS = {
  sportsMin: 1,
  sportsMax: 5,
  frequencyMin: 1,
  frequencyMax: 7,
  durationMin: 10,
  durationMax: 600,
  yearsMin: 0,
  yearsMax: 80,
  daysMin: 1,
  daysMax: 7,
  timeSlotsMin: 1,
  timeSlotsMax: 4,
} as const;

/**
 * Límites de `NutritionHabitsRequest` (ADR-035). Los de listas y enteros están en
 * el esquema; el rango de la hidratación, en la descripción de su campo.
 */
export const NUTRITION_HABITS_LIMITS = {
  restrictionsMax: 7,
  allergiesMax: 9,
  mealsMin: 1,
  mealsMax: 8,
  hydrationMin: '0.5',
  hydrationMax: '10.0',
} as const;

/** Patrón de `country_code` en el contrato. */
export const PROFILE_COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;
/** Patrón de `weight_kg`, `body_temperature_c` y `hydration_liters_per_day` en la solicitud. */
export const PROFILE_DECIMAL_PATTERN = /^\d{1,3}(\.\d)?$/;
/** Patrón de `measured_at` en la solicitud. */
export const MEASURED_AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/** Códigos de error que el contrato declara para los tres comandos. */
export const PROFILE_ERROR_CODES = {
  invalidAccessToken: 'invalid_access_token',
  permissionRequired: 'permission_required',
  versionConflict: 'version_conflict',
  idempotencyKeyReused: 'idempotency_key_reused',
  validationError: 'validation_error',
  upstreamUnavailable: 'upstream_unavailable',
  upstreamTimeout: 'upstream_timeout',
} as const;

/**
 * `404` del `PATCH` de hábitos deportivos (HU008): aún no hay hábitos que
 * actualizar; primero se registran (HU006).
 */
export const SPORT_HABITS_NOT_FOUND = 'sport_habits_not_found';

/**
 * Catálogo de `details[].issue` de `validation_error` (ADR-034, reglas comunes).
 * El OpenAPI lo referencia como «catálogo de ADR-034».
 */
export const PROFILE_ISSUES = [
  'required',
  'field_not_allowed',
  'invalid_length',
  'unknown_value',
  'out_of_range',
  'too_many_decimals',
  'invalid_date',
  'invalid_datetime',
  'too_far_in_future',
  'too_old',
  'duplicate_value',
  'too_many_items',
  'inconsistent_values',
  'unsupported_consent_version',
] as const;

/**
 * Campo de `details` en `409 version_conflict`: su `issue` es la versión vigente
 * como texto (`"0"` si la sección no existe).
 */
export const VERSION_CONFLICT_FIELD = 'expected_version';

/** Cabecera de respuesta que marca el resultado de un reintento idempotente. */
export const PROFILE_IDEMPOTENT_REPLAYED_HEADER = 'Idempotent-Replayed';

/** Cliente del BFF web para el perfil del deportista (HU005, HU006, HU008 y HU009). */
@Injectable({ providedIn: 'root' })
export class BffWebProfileApi {
  private readonly http = inject(HttpClient);
  private readonly bffWebUrl = inject(BffWebUrl);

  /** Perfil proyectado del deportista de la sesión. */
  getProfile(accessToken: string): Observable<ProfileResponseDto> {
    return this.http.get<ProfileResponseDto>(this.bffWebUrl.resolve('v1/me/profile'), {
      headers: new HttpHeaders({ Authorization: `Bearer ${accessToken}` }),
    });
  }

  /**
   * Registra o reemplaza la sección demográfica. Se devuelve la respuesta
   * completa para distinguir `201`/`200` y leer `Idempotent-Replayed`.
   *
   * @param idempotencyKey UUID (`Idempotency-Key`); igual en todos los reintentos
   * del mismo intento lógico.
   */
  putDemographicProfile(
    accessToken: string,
    body: DemographicProfileRequestDto,
    idempotencyKey: string,
  ): Observable<HttpResponse<DemographicProfileResponseDto>> {
    return this.http.put<DemographicProfileResponseDto>(
      this.bffWebUrl.resolve('v1/me/demographic-profile'),
      body,
      { headers: commandHeaders(accessToken, idempotencyKey), observe: 'response' },
    );
  }

  /** Registra o reemplaza la sección fisiológica; mismas reglas que la demográfica. */
  putPhysiologicalProfile(
    accessToken: string,
    body: PhysiologicalProfileRequestDto,
    idempotencyKey: string,
  ): Observable<HttpResponse<PhysiologicalProfileResponseDto>> {
    return this.http.put<PhysiologicalProfileResponseDto>(
      this.bffWebUrl.resolve('v1/me/physiological-profile'),
      body,
      { headers: commandHeaders(accessToken, idempotencyKey), observe: 'response' },
    );
  }

  /** Registra o reemplaza los hábitos deportivos (HU006); mismas reglas que las secciones de HU005. */
  putSportHabits(
    accessToken: string,
    body: SportHabitsRequestDto,
    idempotencyKey: string,
  ): Observable<HttpResponse<SportHabitsResponseDto>> {
    return this.http.put<SportHabitsResponseDto>(
      this.bffWebUrl.resolve('v1/me/sport-habits'),
      body,
      { headers: commandHeaders(accessToken, idempotencyKey), observe: 'response' },
    );
  }

  /**
   * Actualiza parcialmente los hábitos deportivos (HU008): solo las secciones
   * presentes en `body`; mismas cabeceras y respuesta completa que el `PUT`.
   */
  patchSportHabits(
    accessToken: string,
    body: SportHabitsPatchRequestDto,
    idempotencyKey: string,
  ): Observable<HttpResponse<SportHabitsResponseDto>> {
    return this.http.patch<SportHabitsResponseDto>(
      this.bffWebUrl.resolve('v1/me/sport-habits'),
      body,
      { headers: commandHeaders(accessToken, idempotencyKey), observe: 'response' },
    );
  }

  /**
   * Registra o reemplaza los hábitos alimenticios (HU009); mismas reglas que las
   * secciones de HU005 y el consentimiento de datos de salud de la fisiológica.
   */
  putNutritionHabits(
    accessToken: string,
    body: NutritionHabitsRequestDto,
    idempotencyKey: string,
  ): Observable<HttpResponse<NutritionHabitsResponseDto>> {
    return this.http.put<NutritionHabitsResponseDto>(
      this.bffWebUrl.resolve('v1/me/nutrition-habits'),
      body,
      { headers: commandHeaders(accessToken, idempotencyKey), observe: 'response' },
    );
  }
}

function commandHeaders(accessToken: string, idempotencyKey: string): HttpHeaders {
  return new HttpHeaders({
    Authorization: `Bearer ${accessToken}`,
    'Idempotency-Key': idempotencyKey,
  });
}
