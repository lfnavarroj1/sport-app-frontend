import {
  HEALTH_REPORT_TYPES,
  HEALTH_SEVERITIES,
  HealthBodyAreaDto,
  HealthReportStatusDto,
  HealthReportTypeDto,
  HealthSeverityDto,
} from '../../../core/api/bff-web/health-reports.api';

export type HealthReportType = HealthReportTypeDto;
export type HealthSeverity = HealthSeverityDto;
export type HealthBodyArea = HealthBodyAreaDto;
export type HealthReportStatus = HealthReportStatusDto;

/** Opciones de los filtros, en el orden del contrato (ADR-037). */
export const HEALTH_TYPE_OPTIONS: readonly HealthReportType[] = HEALTH_REPORT_TYPES;
export const HEALTH_SEVERITY_OPTIONS: readonly HealthSeverity[] = HEALTH_SEVERITIES;

/** De quién es el historial de salud que se consulta (HU012). */
export type HealthScope =
  | { readonly kind: 'own' }
  /** Deportista que autorizó al profesional de la sesión (relación vigente, CA2). */
  | { readonly kind: 'athlete'; readonly athleteId: string };

/** Filtros del historial; `null` significa sin filtro. */
export interface HealthFilters {
  /** Día UTC inicial de `occurred_at`, inclusivo (`YYYY-MM-DD`). */
  readonly from: string | null;
  /** Día UTC final de `occurred_at`, inclusivo (`YYYY-MM-DD`). */
  readonly to: string | null;
  readonly type: HealthReportType | null;
  readonly severity: HealthSeverity | null;
}

export const NO_HEALTH_FILTERS: HealthFilters = {
  from: null,
  to: null,
  type: null,
  severity: null,
};

/**
 * Reporte de molestia, incapacidad o lesión de HU042, con solo los campos que
 * ADR-037 expone. Dato de salud: vive en memoria y nunca se registra.
 */
export interface HealthReport {
  readonly id: string;
  readonly type: HealthReportType;
  readonly bodyArea: HealthBodyArea;
  readonly severity: HealthSeverity;
  /** Instante ISO 8601 UTC; se muestra en la zona del navegador. */
  readonly occurredAt: string;
  /** Días de recuperación que estimó el deportista; `null` si no la indicó. */
  readonly expectedRecoveryDays: number | null;
  readonly status: HealthReportStatus;
  /** Sesión de entrenamiento asociada (HU032), si la hay. */
  readonly sessionId: string | null;
}

/** Una página, en el orden estable del backend (`occurred_at` y `report_id` desc). */
export interface HealthReportsPage {
  readonly reports: readonly HealthReport[];
  /** Cursor opaco de la página siguiente; `null` si no hay más. */
  readonly nextCursor: string | null;
}

export interface RecoveryText {
  readonly key: string;
  readonly params: Readonly<Record<string, number>>;
}

/** Recuperación esperada legible (claves i18n); sin estimación si no la hay. */
export function recoveryText(days: number | null): RecoveryText {
  if (days === null) {
    return { key: 'training.health.recovery.none', params: {} };
  }
  return {
    key: days === 1 ? 'training.health.recovery.one' : 'training.health.recovery.days',
    params: { days },
  };
}

export function hasHealthFilters(filters: HealthFilters): boolean {
  return (
    filters.from !== null ||
    filters.to !== null ||
    filters.type !== null ||
    filters.severity !== null
  );
}
