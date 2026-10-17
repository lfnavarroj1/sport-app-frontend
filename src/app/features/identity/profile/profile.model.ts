import { ApiError } from '../../../core/api/api-error';
import {
  DemographicProfileRequestDto,
  DemographicProfileSectionDto,
  GenderDto,
  IncomeRangeDto,
  MaritalStatusDto,
  PROFILE_ISSUES,
  PhysiologicalProfileRequestDto,
  PhysiologicalProfileSectionDto,
  ProfileResponseDto,
} from '../../../core/api/bff-web/profile.api';

export type Gender = GenderDto;
export type MaritalStatus = MaritalStatusDto;
export type IncomeRange = IncomeRangeDto;

/** Sección demográfica confirmada por el backend (HU005). */
export interface DemographicProfile {
  readonly version: number;
  /** `YYYY-MM-DD`. */
  readonly birthDate: string;
  readonly gender: Gender;
  readonly countryCode: string;
  readonly city: string;
  readonly maritalStatus: MaritalStatus | null;
  readonly occupation: string | null;
  readonly incomeRange: IncomeRange | null;
  /** Instante UTC (`Z`). */
  readonly updatedAt: string;
}

export interface BloodPressure {
  readonly systolic: number;
  readonly diastolic: number;
}

/**
 * Sección fisiológica confirmada por el backend (HU005). Los decimales se
 * conservan como el texto del contrato (`"68.5"`); el IMC lo calcula el backend.
 */
export interface PhysiologicalProfile {
  readonly version: number;
  readonly consentVersion: string;
  /** Instante UTC (`Z`) en que se aceptó el consentimiento. */
  readonly consentAcceptedAt: string;
  /** Instante UTC (`Z`) de la medición. */
  readonly measuredAt: string;
  readonly weightKg: string;
  readonly heightCm: number;
  readonly bmi: string;
  readonly restingHeartRateBpm: number | null;
  readonly bloodPressure: BloodPressure | null;
  readonly bodyTemperatureC: string | null;
  readonly updatedAt: string;
}

/** Perfil proyectado: `null` en las secciones aún sin datos (consistencia eventual). */
export interface AthleteProfile {
  readonly demographic: DemographicProfile | null;
  readonly physiological: PhysiologicalProfile | null;
  /** Instante UTC de la última proyección aplicada, o `null`. */
  readonly projectedAt: string | null;
}

/** Datos demográficos que captura el deportista. Los textos ya vienen recortados. */
export interface DemographicDraft {
  readonly birthDate: string;
  readonly gender: Gender;
  /** ISO 3166-1 alfa-2 en mayúsculas. */
  readonly countryCode: string;
  readonly city: string;
  readonly maritalStatus: MaritalStatus | null;
  readonly occupation: string | null;
  readonly incomeRange: IncomeRange | null;
}

/** Datos fisiológicos que captura el deportista, ya normalizados para el contrato. */
export interface PhysiologicalDraft {
  /** Versión del consentimiento que aceptó (la de `healthDataConsentVersion`). */
  readonly consentVersion: string;
  /** Instante UTC con precisión de segundos (`YYYY-MM-DDTHH:MM:SSZ`). */
  readonly measuredAt: string;
  /** Decimal como texto con punto (`"68.5"`). */
  readonly weightKg: string;
  readonly heightCm: number;
  readonly restingHeartRateBpm: number | null;
  readonly bloodPressure: BloodPressure | null;
  readonly bodyTemperatureC: string | null;
}

/** Regla incumplida (`details[{field, issue}]`, ADR-034). */
export interface ProfileViolation {
  /** Ruta del campo (`consent.version`); vacía si el backend no la indica. */
  readonly field: string;
  readonly issue: string;
}

/** Motivos que el cliente sabe explicar; otro motivo se muestra con un texto genérico. */
export const KNOWN_PROFILE_ISSUES: readonly string[] = PROFILE_ISSUES;

/** Resultado de un comando de sección, ya traducido desde el contrato. */
export type SaveOutcome<T> =
  | {
      readonly kind: 'saved';
      readonly section: T;
      /** `201`: la sección se creó; `200`: se reemplazó. */
      readonly created: boolean;
      /** `Idempotent-Replayed: true`: es la respuesta de un envío anterior. */
      readonly replayed: boolean;
    }
  | { readonly kind: 'invalid'; readonly violations: readonly ProfileViolation[] }
  /**
   * `409 version_conflict`: otra sesión cambió la sección. `currentVersion` es la
   * vigente que informó el backend (`0` si la sección no existe), o `null`.
   */
  | { readonly kind: 'conflict'; readonly currentVersion: number | null }
  | { readonly kind: 'failed'; readonly error: ApiError };

/** `expected_version` se omite al crear y es la última versión conocida al reemplazar. */
export function toDemographicRequest(
  draft: DemographicDraft,
  expectedVersion: number | null,
): DemographicProfileRequestDto {
  return {
    ...(expectedVersion === null ? {} : { expected_version: expectedVersion }),
    birth_date: draft.birthDate,
    gender: draft.gender,
    country_code: draft.countryCode,
    city: draft.city,
    marital_status: draft.maritalStatus,
    occupation: draft.occupation,
    income_range: draft.incomeRange,
  };
}

/** Cuerpo de ADR-034: sin `bmi` ni `user_id`. */
export function toPhysiologicalRequest(
  draft: PhysiologicalDraft,
  expectedVersion: number | null,
): PhysiologicalProfileRequestDto {
  return {
    ...(expectedVersion === null ? {} : { expected_version: expectedVersion }),
    consent: { version: draft.consentVersion },
    measured_at: draft.measuredAt,
    weight_kg: draft.weightKg,
    height_cm: draft.heightCm,
    resting_heart_rate_bpm: draft.restingHeartRateBpm,
    blood_pressure:
      draft.bloodPressure === null
        ? null
        : {
            systolic_mmhg: draft.bloodPressure.systolic,
            diastolic_mmhg: draft.bloodPressure.diastolic,
          },
    body_temperature_c: draft.bodyTemperatureC,
  };
}

export function toDemographicProfile(dto: DemographicProfileSectionDto): DemographicProfile {
  return {
    version: dto.version,
    birthDate: dto.birth_date,
    gender: dto.gender,
    countryCode: dto.country_code,
    city: dto.city,
    maritalStatus: dto.marital_status,
    occupation: dto.occupation,
    incomeRange: dto.income_range,
    updatedAt: dto.updated_at,
  };
}

export function toPhysiologicalProfile(dto: PhysiologicalProfileSectionDto): PhysiologicalProfile {
  return {
    version: dto.version,
    consentVersion: dto.consent.version,
    consentAcceptedAt: dto.consent.accepted_at,
    measuredAt: dto.measured_at,
    weightKg: dto.weight_kg,
    heightCm: dto.height_cm,
    bmi: dto.bmi,
    restingHeartRateBpm: dto.resting_heart_rate_bpm,
    bloodPressure:
      dto.blood_pressure === null
        ? null
        : {
            systolic: dto.blood_pressure.systolic_mmhg,
            diastolic: dto.blood_pressure.diastolic_mmhg,
          },
    bodyTemperatureC: dto.body_temperature_c,
    updatedAt: dto.updated_at,
  };
}

export function toAthleteProfile(dto: ProfileResponseDto): AthleteProfile {
  return {
    demographic: dto.demographic === null ? null : toDemographicProfile(dto.demographic),
    physiological: dto.physiological === null ? null : toPhysiologicalProfile(dto.physiological),
    projectedAt: dto.projected_at,
  };
}

/**
 * Sección más reciente entre la proyectada y la confirmada por un comando: la
 * proyección es eventual, así que la pantalla conserva la respuesta del comando
 * mientras la proyección no la alcance (ADR-034).
 */
export function newerSection<T extends { readonly version: number }>(
  projected: T | null,
  confirmed: T | null,
): T | null {
  if (projected === null) {
    return confirmed;
  }
  if (confirmed === null) {
    return projected;
  }
  return confirmed.version > projected.version ? confirmed : projected;
}

/**
 * Versión vigente que informa `409 version_conflict` en
 * `details[{field: "expected_version", issue: "<versión>"}]`; `null` si no la trae.
 */
export function conflictVersion(
  details: readonly { readonly field?: string | null; readonly issue: string }[],
): number | null {
  const detail = details.find((item) => item.field === 'expected_version');
  return detail !== undefined && /^\d+$/.test(detail.issue) ? Number(detail.issue) : null;
}

/**
 * Normaliza el texto de un decimal para el contrato: recorta y acepta la coma
 * decimal de `es`. No convierte a número: el valor viaja como cadena (ADR-034).
 */
export function normalizeDecimal(text: string): string {
  return text.trim().replace(',', '.');
}

/** Décimas de un decimal ya normalizado (`"68.5"` → 685), o `null` si no lo es. */
export function decimalTenths(text: string): number | null {
  const match = /^(\d{1,3})(?:\.(\d))?$/.exec(text);
  return match ? Number(match[1]) * 10 + Number(match[2] ?? '0') : null;
}

/**
 * Edad cumplida en una fecha (informativa: la regla autoritativa es del
 * backend). `birthDate` y `today` en `YYYY-MM-DD`; `null` si no son fechas.
 */
export function ageOn(birthDate: string, today: string): number | null {
  const birth = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  const now = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today);
  if (!birth || !now) {
    return null;
  }
  const [, by, bm, bd] = birth.map(Number);
  const [, ny, nm, nd] = now.map(Number);
  return ny - by - (nm < bm || (nm === bm && nd < bd) ? 1 : 0);
}

/** Fecha local del navegador en `YYYY-MM-DD`. */
export function localDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Fecha y hora locales del navegador para `<input type="datetime-local">`
 * (`YYYY-MM-DDTHH:mm`), sin segundos.
 */
export function toLocalDateTimeInput(date: Date): string {
  return `${localDate(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Convierte la fecha y hora locales del navegador (`YYYY-MM-DDTHH:mm`) al
 * formato de `measured_at`: UTC con sufijo `Z` y precisión de segundos. `null`
 * si el texto no es una fecha y hora válidas.
 */
export function localDateTimeToUtc(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
