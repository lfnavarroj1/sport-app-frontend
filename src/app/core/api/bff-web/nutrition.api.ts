import { HttpClient, HttpHeaders, HttpParams, HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { BffWebUrl } from '../bff-web-url';
import { STRICT_CODEC } from './training-history.api';

/**
 * Transporte de las operaciones de HU014 del contrato bff-web 0.18.0 (ver
 * `contract.ts`, ADR-037): catálogo cerrado de alimentos y creación y consulta
 * de planes de alimentación. Todas se autentican con el access token
 * (`Authorization: Bearer`). Estos tipos son del transporte: la interfaz los
 * transforma antes de usarlos.
 */

/** Enumeración `FoodUnit`. */
export const FOOD_UNITS = ['G', 'ML', 'UNIT', 'CUP', 'TBSP'] as const;
export type FoodUnitDto = (typeof FOOD_UNITS)[number];

/** Enumeración `FoodCategory`. */
export const FOOD_CATEGORIES = [
  'GRAIN',
  'PROTEIN',
  'DAIRY',
  'FRUIT',
  'VEGETABLE',
  'LEGUME',
  'FAT',
  'BEVERAGE',
  'SUPPLEMENT',
] as const;
export type FoodCategoryDto = (typeof FOOD_CATEGORIES)[number];

/** Enumeración `MealType`. */
export const MEAL_TYPES = ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK', 'HYDRATION'] as const;
export type MealTypeDto = (typeof MEAL_TYPES)[number];

/** Aviso de `CreatedNutritionPlanResponse.warnings` (`const` del contrato). */
export const NUTRITION_HABITS_MISSING = 'nutrition_habits_missing';

/** Esquema `FoodCatalogItem`. */
export interface FoodCatalogItemDto {
  readonly food_code: string;
  readonly label_key: string;
  readonly category: FoodCategoryDto;
  readonly default_unit: FoodUnitDto;
  readonly allowed_units: readonly FoodUnitDto[];
  readonly allergens: readonly string[];
  readonly incompatible_with: readonly string[];
}

/** Esquema `FoodCatalogResponse`. */
export interface FoodCatalogResponseDto {
  readonly catalog_version: string;
  readonly items: readonly FoodCatalogItemDto[];
}

/** Esquema `NutritionPlanItem`; `quantity` es una cadena decimal. */
export interface NutritionPlanItemDto {
  readonly food_code: string;
  readonly quantity: string;
  readonly unit: FoodUnitDto;
}

/** Esquema `NutritionPlanMeal`. */
export interface NutritionPlanMealDto {
  readonly meal_type: MealTypeDto;
  readonly items: readonly NutritionPlanItemDto[];
}

/** Esquema `CreateNutritionPlanRequest`; las fechas son `YYYY-MM-DD`. */
export interface CreateNutritionPlanRequestDto {
  readonly athlete_email: string;
  readonly title: string;
  readonly objectives: readonly string[];
  readonly start_date: string;
  readonly end_date: string;
  readonly meals: readonly NutritionPlanMealDto[];
}

/** Esquema `NutritionPlanResponse` (consultas; lectura CQRS). */
export interface NutritionPlanResponseDto {
  readonly plan_id: string;
  readonly athlete_id: string;
  readonly professional_id: string;
  readonly title: string;
  readonly objectives: readonly string[];
  readonly start_date: string;
  readonly end_date: string;
  readonly status: 'ASSIGNED';
  readonly version: number;
  readonly catalog_version: string;
  readonly meals: readonly NutritionPlanMealDto[];
  readonly created_at: string;
}

/** Esquema `CreatedNutritionPlanResponse`: el plan confirmado más sus avisos. */
export interface CreatedNutritionPlanResponseDto extends NutritionPlanResponseDto {
  readonly warnings: readonly (typeof NUTRITION_HABITS_MISSING)[];
}

/** Esquema `NutritionPlansPage`. */
export interface NutritionPlansPageDto {
  readonly items: readonly NutritionPlanResponseDto[];
  readonly next_cursor: string | null;
}

/** Límites de `CreateNutritionPlanRequest`, `NutritionPlanMeal` y `NutritionPlanItem`. */
export const NUTRITION_PLAN_LIMITS = {
  emailMax: 254,
  titleMax: 120,
  objectivesMin: 1,
  objectivesMax: 5,
  objectiveMax: 200,
  mealsMin: 1,
  mealsMax: 8,
  itemsMin: 1,
  itemsMax: 15,
  quantityMax: 17,
} as const;

/** `pattern` de `NutritionPlanItem.quantity`. */
export const QUANTITY_PATTERN = '^[0-9]{1,8}(\\.[0-9]{1,8})?$';

/** Cabecera de respuesta que marca el resultado de un reintento idempotente. */
export const IDEMPOTENT_REPLAYED_HEADER = 'Idempotent-Replayed';

/** Versión del catálogo en `GET /v1/food-catalog`; se reenvía en `If-None-Match`. */
export const ETAG_HEADER = 'ETag';

/** Códigos de error de `GET /v1/food-catalog`. */
export const FOOD_CATALOG_ERROR_CODES = {
  invalidAccessToken: 'invalid_access_token',
  upstreamUnavailable: 'upstream_unavailable',
  upstreamTimeout: 'upstream_timeout',
} as const;

/** Códigos de error de `POST /v1/nutrition-plans`. */
export const CREATE_NUTRITION_PLAN_ERROR_CODES = {
  invalidAccessToken: 'invalid_access_token',
  permissionRequired: 'permission_required',
  athleteAuthorizationRequired: 'athlete_authorization_required',
  idempotencyKeyReused: 'idempotency_key_reused',
  validationError: 'validation_error',
  nutritionPlanInvalid: 'nutrition_plan_invalid',
  upstreamUnavailable: 'upstream_unavailable',
  upstreamTimeout: 'upstream_timeout',
} as const;

/**
 * Motivos estables de `details[].issue` en `nutrition_plan_invalid`, enumerados
 * en la descripción del `422` de `POST /v1/nutrition-plans`.
 */
export const NUTRITION_PLAN_ISSUES = [
  'end_date_before_start_date',
  'period_too_long',
  'unknown_value',
  'unit_not_allowed',
  'out_of_range',
  'conflicts_with_allergy',
  'conflicts_with_restriction',
] as const;

/** Códigos de error de `GET /v1/nutrition-plans/{plan_id}`. */
export const GET_NUTRITION_PLAN_ERROR_CODES = {
  invalidAccessToken: 'invalid_access_token',
  permissionRequired: 'permission_required',
  athleteAuthorizationRequired: 'athlete_authorization_required',
  nutritionPlanNotFound: 'nutrition_plan_not_found',
  upstreamUnavailable: 'upstream_unavailable',
  upstreamTimeout: 'upstream_timeout',
} as const;

/** Códigos de error de `GET /v1/me/nutrition-plans`. */
export const MY_NUTRITION_PLANS_ERROR_CODES = {
  invalidAccessToken: 'invalid_access_token',
  permissionRequired: 'permission_required',
  validationError: 'validation_error',
  upstreamUnavailable: 'upstream_unavailable',
  upstreamTimeout: 'upstream_timeout',
} as const;

/** Cliente del BFF web para HU014. El usuario sale del access token. */
@Injectable({ providedIn: 'root' })
export class BffWebNutritionApi {
  private readonly http = inject(HttpClient);
  private readonly bffWebUrl = inject(BffWebUrl);

  /**
   * Catálogo cerrado de alimentos. Con `etag` se envía `If-None-Match`; si el
   * catálogo no cambió el BFF responde `304` sin cuerpo, que `HttpClient` entrega
   * como error con estado `304`.
   */
  getFoodCatalog(
    accessToken: string,
    etag: string | null,
  ): Observable<HttpResponse<FoodCatalogResponseDto>> {
    let headers = bearer(accessToken);
    if (etag !== null) {
      headers = headers.set('If-None-Match', etag);
    }
    return this.http.get<FoodCatalogResponseDto>(this.bffWebUrl.resolve('v1/food-catalog'), {
      headers,
      observe: 'response',
    });
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
    body: CreateNutritionPlanRequestDto,
    idempotencyKey: string,
  ): Observable<HttpResponse<CreatedNutritionPlanResponseDto>> {
    return this.http.post<CreatedNutritionPlanResponseDto>(
      this.bffWebUrl.resolve('v1/nutrition-plans'),
      body,
      {
        headers: bearer(accessToken).set('Idempotency-Key', idempotencyKey),
        observe: 'response',
      },
    );
  }

  /** Consulta un plan visible para el creador o el deportista asignado. */
  getPlan(accessToken: string, planId: string): Observable<NutritionPlanResponseDto> {
    return this.http.get<NutritionPlanResponseDto>(
      this.bffWebUrl.resolve(`v1/nutrition-plans/${encodeURIComponent(planId)}`),
      { headers: bearer(accessToken) },
    );
  }

  /**
   * Planes del deportista autenticado, con el tamaño de página por defecto del
   * contrato. `cursor` se envía sin modificar.
   */
  getMyPlans(accessToken: string, cursor: string | null): Observable<NutritionPlansPageDto> {
    // El codec estricto de HU011 evita que un `+` del cursor opaco llegue como espacio.
    const params =
      cursor === null ? undefined : new HttpParams({ encoder: STRICT_CODEC }).set('cursor', cursor);
    return this.http.get<NutritionPlansPageDto>(this.bffWebUrl.resolve('v1/me/nutrition-plans'), {
      headers: bearer(accessToken),
      params,
    });
  }
}

function bearer(accessToken: string): HttpHeaders {
  return new HttpHeaders({ Authorization: `Bearer ${accessToken}` });
}
