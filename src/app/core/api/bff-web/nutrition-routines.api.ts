import { HttpClient, HttpHeaders, HttpParams, HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { BffWebUrl } from '../bff-web-url';
import { MEAL_TYPES, MealTypeDto } from './nutrition.api';
import { DIET_PATTERNS, DietPatternDto, FOOD_ALLERGIES, FoodAllergyDto } from './profile.api';
import { STRICT_CODEC } from './training-history.api';
import {
  TEMPLATE_GOALS,
  TEMPLATE_SPORTS,
  TemplateGoalDto,
  TemplateSportDto,
} from './training-templates.api';

/**
 * Transporte de las operaciones de HU030 del contrato bff-web 0.34.0 (ver
 * `contract.ts`, ADR-041): `POST /v1/nutrition-routine-templates`
 * (`publish_routine_v1_nutrition_routine_templates_post`),
 * `POST /v1/nutrition-routine-templates/{template_id}/retire`
 * (`retire_routine_v1_nutrition_routine_templates__template_id__retire_post`) y
 * `GET /v1/me/nutrition-routine-templates` (`my_routines_v1_me_nutrition_routine_templates_get`).
 * Solo `service_provider` con `nutrition.plan.author`; el profesional sale del
 * token. Una rutina no es un plan asignado de HU014. Estos tipos son del
 * transporte: la interfaz los transforma antes de usarlos.
 */

/** Esquema `Sport`: el catálogo de deportes de HU010. */
export const ROUTINE_SPORTS = TEMPLATE_SPORTS;
export type RoutineSportDto = TemplateSportDto;

/** Esquema `Goal`: catálogo de objetivos de ADR-034. */
export const ROUTINE_GOALS = TEMPLATE_GOALS;
export type RoutineGoalDto = TemplateGoalDto;

/** Esquema `DietPattern`: catálogo `diet_pattern` de HU009 (ADR-035). */
export const ROUTINE_DIET_PATTERNS = DIET_PATTERNS;
export type RoutineDietPatternDto = DietPatternDto;

/** Esquema `Allergy`: catálogo de alergias de HU009 (ADR-035), en su orden. */
export const ROUTINE_ALLERGENS = FOOD_ALLERGIES;
export type RoutineAllergenDto = FoodAllergyDto;

/** Esquema `MealType`. */
export const ROUTINE_MEAL_TYPES = MEAL_TYPES;
export type RoutineMealTypeDto = MealTypeDto;

/** Enumeración `status` de `RoutineResponse`. */
export const ROUTINE_STATUSES = ['PUBLISHED', 'RETIRED'] as const;
export type RoutineStatusDto = (typeof ROUTINE_STATUSES)[number];

/** Esquemas `RoutineItemRequest` y `RoutineItemResponse`. */
export interface RoutineItemDto {
  /** Código del catálogo de alimentos (`GET /v1/food-catalog`). */
  readonly food_code: string;
  readonly portions: number;
}

/** Esquemas `RoutineMealRequest` y `RoutineMealResponse`. */
export interface RoutineMealDto {
  readonly meal: RoutineMealTypeDto;
  readonly items: readonly RoutineItemDto[];
}

/** Esquema `PublishRoutineRequest`: sin `professional_id` ni campos adicionales. */
export interface PublishRoutineRequestDto {
  readonly title: string;
  readonly description: string;
  readonly goal: RoutineGoalDto;
  /** Opcional en el contrato; la web siempre lo envía, `null` si no aplica. */
  readonly sport: RoutineSportDto | null;
  readonly dietary_pattern: RoutineDietPatternDto;
  /** Sin repetir; puede ir vacía. El servicio agrega los alérgenos de cada alimento. */
  readonly contains_allergens: readonly RoutineAllergenDto[];
  readonly duration_days: number;
  /** Comidas de un día tipo, en el orden del profesional. */
  readonly daily_meals: readonly RoutineMealDto[];
}

/** Esquema `RetireRoutineRequest`. */
export interface RetireRoutineRequestDto {
  /** Versión vigente que conoce el cliente. */
  readonly expected_version: number;
}

/** Esquema `RoutineResponse`. */
export interface RoutineResponseDto {
  readonly template_id: string;
  readonly professional_id: string;
  readonly title: string;
  readonly description: string;
  readonly goal: RoutineGoalDto;
  readonly sport: RoutineSportDto | null;
  readonly dietary_pattern: RoutineDietPatternDto;
  /** En el orden del catálogo de HU009. */
  readonly contains_allergens: readonly RoutineAllergenDto[];
  /** Vigencia de la rutina en días. */
  readonly duration_days: number;
  readonly daily_meals: readonly RoutineMealDto[];
  readonly status: RoutineStatusDto;
  readonly version: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly published_at: string;
  readonly retired_at: string | null;
}

/** Esquema `RoutinesResponse`: orden `created_at` y `template_id` descendentes. */
export interface RoutinesResponseDto {
  readonly items: readonly RoutineResponseDto[];
  readonly next_cursor: string | null;
}

/** Parámetros de `GET /v1/me/nutrition-routine-templates`; los ausentes no se envían. */
export interface MyRoutinesQueryDto {
  /** 1–50; el BFF usa 20 si no se envía. */
  readonly limit?: number | null;
  /** Cursor opaco de `next_cursor`; la web nunca lo interpreta. */
  readonly cursor?: string | null;
}

/** Límites del contrato (`PublishRoutineRequest`, `GET /v1/me/nutrition-routine-templates`). */
export const ROUTINE_LIMITS = {
  titleMin: 3,
  titleMax: 120,
  descriptionMin: 1,
  descriptionMax: 2000,
  daysMin: 1,
  daysMax: 90,
  allergensMax: 9,
  mealsMin: 1,
  mealsMax: 8,
  itemsMin: 1,
  itemsMax: 15,
  foodCodeMax: 64,
  portionsMin: 1,
  portionsMax: 10,
  listMin: 1,
  listMax: 50,
  listDefault: 20,
} as const;

/** Cabecera de respuesta que marca el resultado de un reintento idempotente. */
export const ROUTINE_IDEMPOTENT_REPLAYED_HEADER = 'Idempotent-Replayed';

/** Códigos de error de `POST /v1/nutrition-routine-templates`. */
export const PUBLISH_ROUTINE_ERROR_CODES = {
  invalidAccessToken: 'invalid_access_token',
  permissionRequired: 'permission_required',
  idempotencyKeyReused: 'idempotency_key_reused',
  validationError: 'validation_error',
  upstreamUnavailable: 'upstream_unavailable',
  upstreamTimeout: 'upstream_timeout',
} as const;

/** Motivos de `details[].issue` que el `422` de publicar declara además de los de forma. */
export const PUBLISH_ROUTINE_ISSUES = [
  'unknown_value',
  'conflicts_with_restriction',
  'duplicate_value',
] as const;

/** Códigos de error de `POST /v1/nutrition-routine-templates/{template_id}/retire`. */
export const RETIRE_ROUTINE_ERROR_CODES = {
  invalidAccessToken: 'invalid_access_token',
  permissionRequired: 'permission_required',
  templateNotFound: 'template_not_found',
  versionConflict: 'version_conflict',
  validationError: 'validation_error',
  upstreamUnavailable: 'upstream_unavailable',
  upstreamTimeout: 'upstream_timeout',
} as const;

/** Códigos de error de `GET /v1/me/nutrition-routine-templates`. */
export const MY_ROUTINES_ERROR_CODES = {
  invalidAccessToken: 'invalid_access_token',
  permissionRequired: 'permission_required',
  validationError: 'validation_error',
  upstreamUnavailable: 'upstream_unavailable',
  upstreamTimeout: 'upstream_timeout',
} as const;

/** Cliente del BFF web para las rutinas de alimentación del profesional (HU030). */
@Injectable({ providedIn: 'root' })
export class BffWebNutritionRoutinesApi {
  private readonly http = inject(HttpClient);
  private readonly bffWebUrl = inject(BffWebUrl);

  /**
   * Publica una rutina (nace `PUBLISHED` en versión 1). Se devuelve la respuesta
   * completa para leer `Idempotent-Replayed`.
   *
   * @param idempotencyKey UUID obligatorio; igual en los reintentos del mismo intento lógico.
   */
  publishRoutine(
    accessToken: string,
    body: PublishRoutineRequestDto,
    idempotencyKey: string,
  ): Observable<HttpResponse<RoutineResponseDto>> {
    return this.http.post<RoutineResponseDto>(
      this.bffWebUrl.resolve('v1/nutrition-routine-templates'),
      body,
      {
        headers: bearer(accessToken).set('Idempotency-Key', idempotencyKey),
        observe: 'response',
      },
    );
  }

  /** Retira una rutina propia: `PUBLISHED` → `RETIRED`; una ya retirada se devuelve tal cual. */
  retireRoutine(
    accessToken: string,
    templateId: string,
    body: RetireRoutineRequestDto,
  ): Observable<RoutineResponseDto> {
    return this.http.post<RoutineResponseDto>(
      this.bffWebUrl.resolve(
        `v1/nutrition-routine-templates/${encodeURIComponent(templateId)}/retire`,
      ),
      body,
      { headers: bearer(accessToken) },
    );
  }

  /** Rutinas publicadas y retiradas del profesional de la sesión. */
  getMyRoutines(accessToken: string, query: MyRoutinesQueryDto): Observable<RoutinesResponseDto> {
    let params = new HttpParams({ encoder: STRICT_CODEC });
    for (const [name, value] of Object.entries(query)) {
      if (value !== null && value !== undefined && value !== '') {
        params = params.set(name, String(value));
      }
    }
    return this.http.get<RoutinesResponseDto>(
      this.bffWebUrl.resolve('v1/me/nutrition-routine-templates'),
      { headers: bearer(accessToken), params },
    );
  }
}

function bearer(accessToken: string): HttpHeaders {
  return new HttpHeaders({ Authorization: `Bearer ${accessToken}` });
}
