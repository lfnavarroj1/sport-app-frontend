import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { BffWebUrl } from '../bff-web-url';
import { FoodUnitDto, MealTypeDto } from './nutrition.api';
import { STRICT_CODEC } from './training-history.api';

/**
 * Transporte de las consultas de HU013 del contrato bff-web 0.32.0 (ver
 * `contract.ts`, ADR-037): `GET /v1/me/food-intakes` (consumos propios del
 * deportista) y `GET /v1/athletes/{athlete_id}/food-intakes` (profesional con
 * `nutrition.history.view_assigned` y autorización vigente). Ambas se autentican
 * con el access token. Los textos de los alimentos salen de `GET /v1/food-catalog`
 * (HU014). Estos tipos son del transporte: la interfaz los transforma antes de
 * usarlos.
 */

/** Parámetros de consulta; los ausentes no se envían. */
export interface FoodIntakesQueryDto {
  /** Primer día inclusivo (`YYYY-MM-DD`, fecha de consumo en UTC). */
  readonly from?: string | null;
  /** Último día inclusivo (`YYYY-MM-DD`, UTC); no anterior a `from`. */
  readonly to?: string | null;
  readonly meal_type?: MealTypeDto | null;
  /** 1–100; el BFF usa 20 si no se envía. */
  readonly limit?: number | null;
  /** Cursor opaco de `next_cursor`; la web nunca lo interpreta. */
  readonly cursor?: string | null;
}

/** Esquema `FoodIntakeItem`: alimento del consumo, sin calorías ni nutrientes. */
export interface FoodIntakeItemDto {
  readonly food_code: string;
  /** Cadena decimal normalizada con un decimal (`150.0`). */
  readonly quantity: string;
  readonly unit: FoodUnitDto;
}

/** Esquema `FoodIntakeResponse`. Datos de alimentación: sensibles, solo en memoria. */
export interface FoodIntakeResponseDto {
  readonly intake_id: string;
  readonly athlete_id: string;
  readonly consumed_at: string;
  readonly meal_type: MealTypeDto;
  readonly items: readonly FoodIntakeItemDto[];
  readonly catalog_version: string;
  readonly version: number;
  readonly registered_at: string;
}

/** Esquema `FoodIntakesPage`: orden `consumed_at` e `intake_id` descendentes. */
export interface FoodIntakesPageDto {
  readonly items: readonly FoodIntakeResponseDto[];
  readonly next_cursor: string | null;
}

/** Límites del parámetro `limit` en el contrato (iguales en ambas consultas). */
export const FOOD_INTAKES_LIMIT = { min: 1, max: 100, default: 20 } as const;

/** Códigos de error que el contrato declara para ambas consultas de HU013. */
export const FOOD_INTAKES_ERROR_CODES = {
  invalidAccessToken: 'invalid_access_token',
  permissionRequired: 'permission_required',
  athleteAuthorizationRequired: 'athlete_authorization_required',
  validationError: 'validation_error',
  upstreamUnavailable: 'upstream_unavailable',
  upstreamTimeout: 'upstream_timeout',
} as const;

/** Motivos de `422 validation_error` que el contrato documenta por campo (CA2). */
export const FOOD_INTAKES_ISSUES = {
  toBeforeFrom: { field: 'query.to', issue: 'to_before_from' },
  invalidCursor: { field: 'query.cursor', issue: 'invalid_cursor' },
} as const;

/** Cliente del BFF web para HU013. El usuario sale del access token. */
@Injectable({ providedIn: 'root' })
export class BffWebFoodIntakesApi {
  private readonly http = inject(HttpClient);
  private readonly bffWebUrl = inject(BffWebUrl);

  /** Consumos del deportista de la sesión. */
  getOwnIntakes(accessToken: string, query: FoodIntakesQueryDto): Observable<FoodIntakesPageDto> {
    return this.http.get<FoodIntakesPageDto>(this.bffWebUrl.resolve('v1/me/food-intakes'), {
      headers: bearer(accessToken),
      params: toParams(query),
    });
  }

  /** Consumos de un deportista que autorizó al profesional de la sesión. */
  getAthleteIntakes(
    accessToken: string,
    athleteId: string,
    query: FoodIntakesQueryDto,
  ): Observable<FoodIntakesPageDto> {
    return this.http.get<FoodIntakesPageDto>(
      this.bffWebUrl.resolve(`v1/athletes/${encodeURIComponent(athleteId)}/food-intakes`),
      { headers: bearer(accessToken), params: toParams(query) },
    );
  }
}

function bearer(accessToken: string): HttpHeaders {
  return new HttpHeaders({ Authorization: `Bearer ${accessToken}` });
}

function toParams(query: FoodIntakesQueryDto): HttpParams {
  let params = new HttpParams({ encoder: STRICT_CODEC });
  for (const [name, value] of Object.entries(query)) {
    if (value !== null && value !== undefined && value !== '') {
      params = params.set(name, String(value));
    }
  }
  return params;
}
