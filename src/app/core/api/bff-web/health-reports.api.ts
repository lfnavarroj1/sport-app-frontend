import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { BffWebUrl } from '../bff-web-url';
import { STRICT_CODEC } from './training-history.api';

/**
 * Transporte de las consultas de HU012 del contrato bff-web 0.33.0 (ver
 * `contract.ts`, ADR-037): `GET /v1/me/health-reports` (historial propio del
 * deportista) y `GET /v1/athletes/{athlete_id}/health-reports` (profesional con
 * `health.history.view_assigned` y autorización vigente de HU010). Ambas se
 * autentican con el access token. Son datos de salud: estos tipos son del
 * transporte, solo viven en memoria y nunca se registran.
 */

/** Enumeración `HealthReportType`. */
export const HEALTH_REPORT_TYPES = ['DISCOMFORT', 'INJURY', 'INCAPACITY'] as const;
export type HealthReportTypeDto = (typeof HEALTH_REPORT_TYPES)[number];

/** Enumeración `HealthSeverity`. */
export const HEALTH_SEVERITIES = ['LOW', 'MODERATE', 'HIGH'] as const;
export type HealthSeverityDto = (typeof HEALTH_SEVERITIES)[number];

/** Enumeración `HealthBodyArea`. */
export const HEALTH_BODY_AREAS = [
  'HEAD',
  'NECK',
  'SHOULDER',
  'ARM',
  'ELBOW',
  'WRIST_HAND',
  'CHEST',
  'BACK',
  'HIP',
  'THIGH',
  'KNEE',
  'LOWER_LEG',
  'ANKLE_FOOT',
  'OTHER',
] as const;
export type HealthBodyAreaDto = (typeof HEALTH_BODY_AREAS)[number];

/** Enumeración `HealthReportStatus`: el cierre de reportes queda fuera de ADR-037. */
export const HEALTH_REPORT_STATUSES = ['OPEN'] as const;
export type HealthReportStatusDto = (typeof HEALTH_REPORT_STATUSES)[number];

/** Parámetros de consulta; los ausentes no se envían. */
export interface HealthReportsQueryDto {
  /** Día UTC inicial de `occurred_at`, inclusivo (`YYYY-MM-DD`). */
  readonly from?: string | null;
  /** Día UTC final de `occurred_at`, inclusivo (`YYYY-MM-DD`). */
  readonly to?: string | null;
  readonly type?: HealthReportTypeDto | null;
  readonly severity?: HealthSeverityDto | null;
  /** 1–100; el BFF usa 20 si no se envía. */
  readonly limit?: number | null;
  /** Cursor opaco de `next_cursor`; la web nunca lo interpreta. */
  readonly cursor?: string | null;
}

/** Esquema `HealthReportHistoryItem`: los únicos campos que ADR-037 expone. */
export interface HealthReportHistoryItemDto {
  readonly report_id: string;
  readonly type: HealthReportTypeDto;
  readonly body_area: HealthBodyAreaDto;
  readonly severity: HealthSeverityDto;
  /** Instante UTC con sufijo `Z`. */
  readonly occurred_at: string;
  readonly expected_recovery_days: number | null;
  readonly status: HealthReportStatusDto;
  readonly session_id: string | null;
}

/** Esquema `HealthReportHistoryResponse`: orden `occurred_at` y `report_id` desc. */
export interface HealthReportHistoryResponseDto {
  readonly items: readonly HealthReportHistoryItemDto[];
  readonly next_cursor: string | null;
}

/** Límites del parámetro `limit` en el contrato (iguales en ambas consultas). */
export const HEALTH_REPORTS_LIMIT = { min: 1, max: 100, default: 20 } as const;

/** Códigos de error que el contrato declara para ambas consultas de HU012. */
export const HEALTH_REPORTS_ERROR_CODES = {
  invalidAccessToken: 'invalid_access_token',
  permissionRequired: 'permission_required',
  athleteAuthorizationRequired: 'athlete_authorization_required',
  validationError: 'validation_error',
  upstreamUnavailable: 'upstream_unavailable',
  upstreamTimeout: 'upstream_timeout',
} as const;

/** Cliente del BFF web para HU012. El usuario sale del access token. */
@Injectable({ providedIn: 'root' })
export class BffWebHealthReportsApi {
  private readonly http = inject(HttpClient);
  private readonly bffWebUrl = inject(BffWebUrl);

  /** Reportes del deportista de la sesión. */
  getOwnReports(
    accessToken: string,
    query: HealthReportsQueryDto,
  ): Observable<HealthReportHistoryResponseDto> {
    return this.http.get<HealthReportHistoryResponseDto>(
      this.bffWebUrl.resolve('v1/me/health-reports'),
      { headers: bearer(accessToken), params: toParams(query) },
    );
  }

  /** Reportes de un deportista que autorizó al profesional de la sesión. */
  getAthleteReports(
    accessToken: string,
    athleteId: string,
    query: HealthReportsQueryDto,
  ): Observable<HealthReportHistoryResponseDto> {
    return this.http.get<HealthReportHistoryResponseDto>(
      this.bffWebUrl.resolve(`v1/athletes/${encodeURIComponent(athleteId)}/health-reports`),
      { headers: bearer(accessToken), params: toParams(query) },
    );
  }
}

function bearer(accessToken: string): HttpHeaders {
  return new HttpHeaders({ Authorization: `Bearer ${accessToken}` });
}

/** Mismo codificador estricto de HU011: el cursor opaco llega intacto. */
function toParams(query: HealthReportsQueryDto): HttpParams {
  let params = new HttpParams({ encoder: STRICT_CODEC });
  for (const [name, value] of Object.entries(query)) {
    if (value !== null && value !== undefined && value !== '') {
      params = params.set(name, String(value));
    }
  }
  return params;
}
