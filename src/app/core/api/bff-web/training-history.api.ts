import { HttpClient, HttpHeaders, HttpParameterCodec, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { BffWebUrl } from '../bff-web-url';
import { SportDto } from './training.api';

/**
 * Transporte de las consultas de HU011 del contrato bff-web 0.15.0 (ver
 * `contract.ts`): `GET /v1/training-history` (historial propio del deportista),
 * `GET /v1/athletes/{athlete_id}/training-history` (profesional autorizado) y
 * `GET /v1/me/training-athletes` (deportistas que autorizaron al profesional, CA5).
 * Todas se autentican con el access token. Estos tipos son del transporte: la
 * interfaz los transforma antes de usarlos.
 */

/** Parámetros de consulta; los ausentes no se envían. */
export interface TrainingHistoryQueryDto {
  /** Fecha de fin inclusiva desde la que se consulta (`YYYY-MM-DD`, UTC). */
  readonly from?: string | null;
  /** Fecha de fin inclusiva hasta la que se consulta (`YYYY-MM-DD`, UTC). */
  readonly to?: string | null;
  readonly sport?: SportDto | null;
  /** 1–100; el BFF usa 20 si no se envía. */
  readonly limit?: number | null;
  /** Cursor opaco de `next_cursor`; la web nunca lo interpreta. */
  readonly cursor?: string | null;
}

/** Esquema `SessionHistoryItem`. */
export interface SessionHistoryItemDto {
  readonly session_id: string;
  readonly plan_id: string | null;
  readonly sport: SportDto;
  readonly started_at: string;
  readonly ended_at: string;
  readonly duration_seconds: number;
}

/** Esquema `TrainingHistoryResponse`. */
export interface TrainingHistoryResponseDto {
  readonly items: readonly SessionHistoryItemDto[];
  readonly next_cursor: string | null;
  readonly filters: { readonly sports: readonly SportDto[] };
}

/** Parámetros de `GET /v1/me/training-athletes`; los ausentes no se envían. */
export interface TrainingAthletesQueryDto {
  /** 1–100; el BFF usa 20 si no se envía. */
  readonly limit?: number | null;
  /** Cursor opaco de `next_cursor`; la web nunca lo interpreta. */
  readonly cursor?: string | null;
}

/**
 * Esquema `TrainingAthleteItem`. `full_name` y `email` son datos personales: solo
 * se muestran al profesional autorizado, no se guardan ni se registran.
 */
export interface TrainingAthleteItemDto {
  readonly athlete_id: string;
  readonly full_name: string;
  readonly email: string;
  readonly authorized_at: string;
}

/** Esquema `TrainingAthletesResponse`: orden `authorized_at` y `athlete_id` desc. */
export interface TrainingAthletesResponseDto {
  readonly items: readonly TrainingAthleteItemDto[];
  readonly next_cursor: string | null;
}

/** Límites del parámetro `limit` en el contrato (iguales en las tres consultas). */
export const TRAINING_HISTORY_LIMIT = { min: 1, max: 100, default: 20 } as const;

/** Códigos de error que el contrato declara para ambas consultas de HU011. */
export const TRAINING_HISTORY_ERROR_CODES = {
  invalidAccessToken: 'invalid_access_token',
  permissionRequired: 'permission_required',
  athleteAuthorizationRequired: 'athlete_authorization_required',
  validationError: 'validation_error',
  upstreamUnavailable: 'upstream_unavailable',
  upstreamTimeout: 'upstream_timeout',
} as const;

/** Códigos de error que el contrato declara para `GET /v1/me/training-athletes`. */
export const TRAINING_ATHLETES_ERROR_CODES = {
  invalidAccessToken: 'invalid_access_token',
  permissionRequired: 'permission_required',
  validationError: 'validation_error',
  upstreamUnavailable: 'upstream_unavailable',
  upstreamTimeout: 'upstream_timeout',
} as const;

/** Cliente del BFF web para HU011. El usuario sale del access token. */
@Injectable({ providedIn: 'root' })
export class BffWebTrainingHistoryApi {
  private readonly http = inject(HttpClient);
  private readonly bffWebUrl = inject(BffWebUrl);

  /** Historial del deportista de la sesión. */
  getOwnHistory(
    accessToken: string,
    query: TrainingHistoryQueryDto,
  ): Observable<TrainingHistoryResponseDto> {
    return this.http.get<TrainingHistoryResponseDto>(
      this.bffWebUrl.resolve('v1/training-history'),
      { headers: bearer(accessToken), params: toParams(query) },
    );
  }

  /** Historial de un deportista que autorizó al profesional de la sesión. */
  getAthleteHistory(
    accessToken: string,
    athleteId: string,
    query: TrainingHistoryQueryDto,
  ): Observable<TrainingHistoryResponseDto> {
    return this.http.get<TrainingHistoryResponseDto>(
      this.bffWebUrl.resolve(`v1/athletes/${encodeURIComponent(athleteId)}/training-history`),
      { headers: bearer(accessToken), params: toParams(query) },
    );
  }

  /**
   * Deportistas con autorización vigente para el profesional de la sesión, con
   * nombre y correo que compone el BFF. El cliente no envía identificadores.
   */
  getTrainingAthletes(
    accessToken: string,
    query: TrainingAthletesQueryDto,
  ): Observable<TrainingAthletesResponseDto> {
    return this.http.get<TrainingAthletesResponseDto>(
      this.bffWebUrl.resolve('v1/me/training-athletes'),
      { headers: bearer(accessToken), params: toParams(query) },
    );
  }
}

function bearer(accessToken: string): HttpHeaders {
  return new HttpHeaders({ Authorization: `Bearer ${accessToken}` });
}

/**
 * Codifica todo valor con `encodeURIComponent`. El codificador por defecto deja
 * `+` sin codificar y el servidor lo leería como espacio: el cursor es opaco y
 * debe llegar intacto.
 */
export const STRICT_CODEC: HttpParameterCodec = {
  encodeKey: encodeURIComponent,
  encodeValue: encodeURIComponent,
  decodeKey: decodeURIComponent,
  decodeValue: decodeURIComponent,
};

function toParams(query: TrainingHistoryQueryDto | TrainingAthletesQueryDto): HttpParams {
  let params = new HttpParams({ encoder: STRICT_CODEC });
  for (const [name, value] of Object.entries(query)) {
    if (value !== null && value !== undefined && value !== '') {
      params = params.set(name, String(value));
    }
  }
  return params;
}
