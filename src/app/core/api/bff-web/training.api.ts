import { HttpClient, HttpHeaders, HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { BffWebUrl } from '../bff-web-url';

/**
 * Transporte de las operaciones de HU010 del contrato bff-web 0.16.0 (ver
 * `contract.ts`): autorización del deportista a un profesional y creación y
 * consulta de planes de entrenamiento. Todas se autentican con el access token
 * (`Authorization: Bearer`). Estos tipos son del transporte: la interfaz los
 * transforma antes de usarlos.
 */

/** Enumeración `sport` de `PlannedSession`. */
export const SPORTS = ['running', 'cycling', 'swimming', 'strength', 'other'] as const;
export type SportDto = (typeof SPORTS)[number];

/** Esquema `GrantAuthorizationRequest`. */
export interface GrantAuthorizationRequestDto {
  readonly professional_email: string;
}

/** Esquema `TrainingAuthorizationResponse`. */
export interface TrainingAuthorizationResponseDto {
  readonly athlete_id: string;
  readonly professional_id: string;
  readonly status: 'ACTIVE';
  readonly granted_at: string;
}

/** Esquema `PlannedSession`; las fechas son `YYYY-MM-DD` (`format: date`). */
export interface PlannedSessionDto {
  readonly scheduled_date: string;
  readonly sport: SportDto;
  readonly duration_minutes: number;
  /** Intensidad percibida RPE, escala CR10. */
  readonly intensity_rpe: number;
}

/** Esquema `CreateTrainingPlanRequest`. */
export interface CreateTrainingPlanRequestDto {
  readonly athlete_email: string;
  readonly title: string;
  readonly objectives: readonly string[];
  readonly start_date: string;
  readonly end_date: string;
  readonly sessions: readonly PlannedSessionDto[];
}

/** Esquema `TrainingPlanResponse`. */
export interface TrainingPlanResponseDto {
  readonly plan_id: string;
  readonly athlete_id: string;
  readonly professional_id: string;
  readonly title: string;
  readonly objectives: readonly string[];
  readonly start_date: string;
  readonly end_date: string;
  readonly status: 'ASSIGNED';
  readonly version: number;
  readonly sessions: readonly PlannedSessionDto[];
  readonly created_at: string;
}

/** Límites de `CreateTrainingPlanRequest` y `PlannedSession` en el contrato. */
export const TRAINING_PLAN_LIMITS = {
  emailMax: 254,
  titleMax: 120,
  objectivesMin: 1,
  objectivesMax: 5,
  objectiveMax: 200,
  sessionsMin: 1,
  sessionsMax: 100,
  durationMin: 1,
  durationMax: 600,
  intensityMin: 1,
  intensityMax: 10,
} as const;

/** Cabecera de respuesta que marca el resultado de un reintento idempotente. */
export const IDEMPOTENT_REPLAYED_HEADER = 'Idempotent-Replayed';

/** Códigos de error de `POST /v1/me/training-authorizations`. */
export const GRANT_AUTHORIZATION_ERROR_CODES = {
  invalidAccessToken: 'invalid_access_token',
  permissionRequired: 'permission_required',
  capabilityRequired: 'capability_required',
  professionalNotFound: 'professional_not_found',
  validationError: 'validation_error',
  upstreamUnavailable: 'upstream_unavailable',
  upstreamTimeout: 'upstream_timeout',
} as const;

/** Códigos de error de `DELETE /v1/me/training-authorizations/{professional_id}`. */
export const REVOKE_AUTHORIZATION_ERROR_CODES = {
  invalidAccessToken: 'invalid_access_token',
  permissionRequired: 'permission_required',
  upstreamUnavailable: 'upstream_unavailable',
  upstreamTimeout: 'upstream_timeout',
} as const;

/** Códigos de error de `POST /v1/training-plans`. */
export const CREATE_TRAINING_PLAN_ERROR_CODES = {
  invalidAccessToken: 'invalid_access_token',
  permissionRequired: 'permission_required',
  athleteAuthorizationRequired: 'athlete_authorization_required',
  idempotencyKeyReused: 'idempotency_key_reused',
  validationError: 'validation_error',
  trainingPlanInvalid: 'training_plan_invalid',
  upstreamUnavailable: 'upstream_unavailable',
  upstreamTimeout: 'upstream_timeout',
} as const;

/** Códigos de error de `GET /v1/training-plans/{plan_id}`. */
export const GET_TRAINING_PLAN_ERROR_CODES = {
  invalidAccessToken: 'invalid_access_token',
  permissionRequired: 'permission_required',
  capabilityRequired: 'capability_required',
  trainingPlanNotFound: 'training_plan_not_found',
  upstreamUnavailable: 'upstream_unavailable',
  upstreamTimeout: 'upstream_timeout',
} as const;

/** Cliente del BFF web para HU010. El usuario sale del access token. */
@Injectable({ providedIn: 'root' })
export class BffWebTrainingApi {
  private readonly http = inject(HttpClient);
  private readonly bffWebUrl = inject(BffWebUrl);

  /**
   * El deportista autoriza a un profesional. Responde `201` si la crea o la
   * reactiva y `200` si ya estaba activa; por eso se devuelve la respuesta completa.
   */
  grantAuthorization(
    accessToken: string,
    body: GrantAuthorizationRequestDto,
  ): Observable<HttpResponse<TrainingAuthorizationResponseDto>> {
    return this.http.post<TrainingAuthorizationResponseDto>(
      this.bffWebUrl.resolve('v1/me/training-authorizations'),
      body,
      { headers: bearer(accessToken), observe: 'response' },
    );
  }

  /** El deportista revoca la autorización de un profesional (`204`). */
  revokeAuthorization(accessToken: string, professionalId: string): Observable<void> {
    return this.http.delete<void>(
      this.bffWebUrl.resolve(`v1/me/training-authorizations/${encodeURIComponent(professionalId)}`),
      { headers: bearer(accessToken) },
    );
  }

  /**
   * El profesional crea y asigna un plan. Se devuelve la respuesta completa para
   * leer `Idempotent-Replayed`.
   *
   * @param idempotencyKey UUID obligatorio (`Idempotency-Key`); igual en los
   * reintentos del mismo intento lógico.
   */
  createPlan(
    accessToken: string,
    body: CreateTrainingPlanRequestDto,
    idempotencyKey: string,
  ): Observable<HttpResponse<TrainingPlanResponseDto>> {
    return this.http.post<TrainingPlanResponseDto>(
      this.bffWebUrl.resolve('v1/training-plans'),
      body,
      {
        headers: bearer(accessToken).set('Idempotency-Key', idempotencyKey),
        observe: 'response',
      },
    );
  }

  /** Consulta un plan visible para el creador o el deportista asignado. */
  getPlan(accessToken: string, planId: string): Observable<TrainingPlanResponseDto> {
    return this.http.get<TrainingPlanResponseDto>(
      this.bffWebUrl.resolve(`v1/training-plans/${encodeURIComponent(planId)}`),
      { headers: bearer(accessToken) },
    );
  }
}

function bearer(accessToken: string): HttpHeaders {
  return new HttpHeaders({ Authorization: `Bearer ${accessToken}` });
}
