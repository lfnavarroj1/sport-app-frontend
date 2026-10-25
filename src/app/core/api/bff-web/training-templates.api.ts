import { HttpClient, HttpHeaders, HttpParams, HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { BffWebUrl } from '../bff-web-url';
import { STRICT_CODEC } from './training-history.api';
import { SPORTS, SportDto } from './training.api';

/**
 * Transporte de las operaciones de HU028 del contrato bff-web 0.24.0 (ver
 * `contract.ts`, ADR-041): `POST /v1/training-plan-templates`
 * (`publish_template_v1_training_plan_templates_post`),
 * `POST /v1/training-plan-templates/{template_id}/retire`
 * (`retire_template_v1_training_plan_templates__template_id__retire_post`) y
 * `GET /v1/me/training-plan-templates` (`my_templates_v1_me_training_plan_templates_get`).
 * Solo `service_provider` con `training.plan.author`; el profesional sale del
 * token. Una plantilla no es un plan asignado de HU010. Estos tipos son del
 * transporte: la interfaz los transforma antes de usarlos.
 */

/** Esquema `Sport`: el catálogo de deportes de HU010. */
export const TEMPLATE_SPORTS = SPORTS;
export type TemplateSportDto = SportDto;

/** Esquema `Goal`: catálogo de objetivos de ADR-034 (`primary_goal` de HU006). */
export const TEMPLATE_GOALS = [
  'HEALTH',
  'PERFORMANCE',
  'WEIGHT_MANAGEMENT',
  'RECREATION',
  'COMPETITION',
] as const;
export type TemplateGoalDto = (typeof TEMPLATE_GOALS)[number];

/** Esquema `Level`. */
export const TEMPLATE_LEVELS = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'] as const;
export type TemplateLevelDto = (typeof TEMPLATE_LEVELS)[number];

/** Esquema `DayOfWeek`: días de ADR-034. */
export const TEMPLATE_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
export type TemplateDayDto = (typeof TEMPLATE_DAYS)[number];

/** Enumeración `status` de `TemplateResponse`. */
export const TEMPLATE_STATUSES = ['PUBLISHED', 'RETIRED'] as const;
export type TemplateStatusDto = (typeof TEMPLATE_STATUSES)[number];

/** Esquemas `WeeklySessionRequest` y `WeeklySessionResponse`. */
export interface WeeklySessionDto {
  readonly day_of_week: TemplateDayDto;
  readonly description: string;
  readonly duration_minutes: number;
}

/** Esquema `PublishTemplateRequest`: sin `professional_id` ni campos adicionales. */
export interface PublishTemplateRequestDto {
  readonly title: string;
  readonly objectives: string;
  readonly sport: TemplateSportDto;
  readonly goal: TemplateGoalDto;
  readonly level: TemplateLevelDto;
  readonly duration_weeks: number;
  /** Sesiones de una semana tipo, en el orden del profesional. */
  readonly weekly_sessions: readonly WeeklySessionDto[];
}

/** Esquema `RetireTemplateRequest`. */
export interface RetireTemplateRequestDto {
  /** Versión vigente que conoce el cliente. */
  readonly expected_version: number;
}

/** Esquema `TemplateResponse`. */
export interface TemplateResponseDto {
  readonly template_id: string;
  readonly professional_id: string;
  readonly title: string;
  readonly objectives: string;
  readonly sport: TemplateSportDto;
  readonly goal: TemplateGoalDto;
  readonly level: TemplateLevelDto;
  readonly duration_weeks: number;
  readonly weekly_sessions: readonly WeeklySessionDto[];
  readonly status: TemplateStatusDto;
  readonly version: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly published_at: string;
  readonly retired_at: string | null;
}

/** Esquema `TemplatesResponse`: orden `created_at` y `template_id` descendentes. */
export interface TemplatesResponseDto {
  readonly items: readonly TemplateResponseDto[];
  readonly next_cursor: string | null;
}

/** Parámetros de `GET /v1/me/training-plan-templates`; los ausentes no se envían. */
export interface MyTemplatesQueryDto {
  /** 1–50; el BFF usa 20 si no se envía. */
  readonly limit?: number | null;
  /** Cursor opaco de `next_cursor`; la web nunca lo interpreta. */
  readonly cursor?: string | null;
}

/** Límites del contrato (`PublishTemplateRequest`, `GET /v1/me/training-plan-templates`). */
export const TEMPLATE_LIMITS = {
  titleMin: 3,
  titleMax: 120,
  objectivesMin: 20,
  objectivesMax: 2000,
  weeksMin: 1,
  weeksMax: 52,
  sessionsMin: 1,
  sessionsMax: 14,
  sessionDescriptionMin: 1,
  sessionDescriptionMax: 500,
  sessionMinutesMin: 10,
  sessionMinutesMax: 600,
  listMin: 1,
  listMax: 50,
  listDefault: 20,
} as const;

/** Cabecera de respuesta que marca el resultado de un reintento idempotente. */
export const TEMPLATE_IDEMPOTENT_REPLAYED_HEADER = 'Idempotent-Replayed';

/** Códigos de error de `POST /v1/training-plan-templates`. */
export const PUBLISH_TEMPLATE_ERROR_CODES = {
  invalidAccessToken: 'invalid_access_token',
  permissionRequired: 'permission_required',
  idempotencyKeyReused: 'idempotency_key_reused',
  validationError: 'validation_error',
  upstreamUnavailable: 'upstream_unavailable',
  upstreamTimeout: 'upstream_timeout',
} as const;

/** Códigos de error de `POST /v1/training-plan-templates/{template_id}/retire`. */
export const RETIRE_TEMPLATE_ERROR_CODES = {
  invalidAccessToken: 'invalid_access_token',
  permissionRequired: 'permission_required',
  templateNotFound: 'template_not_found',
  versionConflict: 'version_conflict',
  validationError: 'validation_error',
  upstreamUnavailable: 'upstream_unavailable',
  upstreamTimeout: 'upstream_timeout',
} as const;

/** Códigos de error de `GET /v1/me/training-plan-templates`. */
export const MY_TEMPLATES_ERROR_CODES = {
  invalidAccessToken: 'invalid_access_token',
  permissionRequired: 'permission_required',
  validationError: 'validation_error',
  upstreamUnavailable: 'upstream_unavailable',
  upstreamTimeout: 'upstream_timeout',
} as const;

/** Cliente del BFF web para las plantillas de plan del profesional (HU028). */
@Injectable({ providedIn: 'root' })
export class BffWebTrainingTemplatesApi {
  private readonly http = inject(HttpClient);
  private readonly bffWebUrl = inject(BffWebUrl);

  /**
   * Publica una plantilla (nace `PUBLISHED` en versión 1). Se devuelve la
   * respuesta completa para leer `Idempotent-Replayed`.
   *
   * @param idempotencyKey UUID obligatorio; igual en los reintentos del mismo intento lógico.
   */
  publishTemplate(
    accessToken: string,
    body: PublishTemplateRequestDto,
    idempotencyKey: string,
  ): Observable<HttpResponse<TemplateResponseDto>> {
    return this.http.post<TemplateResponseDto>(
      this.bffWebUrl.resolve('v1/training-plan-templates'),
      body,
      {
        headers: bearer(accessToken).set('Idempotency-Key', idempotencyKey),
        observe: 'response',
      },
    );
  }

  /** Retira una plantilla propia: `PUBLISHED` → `RETIRED`; una ya retirada se devuelve tal cual. */
  retireTemplate(
    accessToken: string,
    templateId: string,
    body: RetireTemplateRequestDto,
  ): Observable<TemplateResponseDto> {
    return this.http.post<TemplateResponseDto>(
      this.bffWebUrl.resolve(`v1/training-plan-templates/${encodeURIComponent(templateId)}/retire`),
      body,
      { headers: bearer(accessToken) },
    );
  }

  /** Plantillas publicadas y retiradas del profesional de la sesión. */
  getMyTemplates(
    accessToken: string,
    query: MyTemplatesQueryDto,
  ): Observable<TemplatesResponseDto> {
    let params = new HttpParams({ encoder: STRICT_CODEC });
    for (const [name, value] of Object.entries(query)) {
      if (value !== null && value !== undefined && value !== '') {
        params = params.set(name, String(value));
      }
    }
    return this.http.get<TemplatesResponseDto>(
      this.bffWebUrl.resolve('v1/me/training-plan-templates'),
      { headers: bearer(accessToken), params },
    );
  }
}

function bearer(accessToken: string): HttpHeaders {
  return new HttpHeaders({ Authorization: `Bearer ${accessToken}` });
}
