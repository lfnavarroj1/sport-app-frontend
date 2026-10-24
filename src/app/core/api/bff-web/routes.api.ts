import { HttpClient, HttpHeaders, HttpParams, HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { BffWebUrl } from '../bff-web-url';
import { STRICT_CODEC } from './training-history.api';
import { SPORTS, SportDto } from './training.api';

/**
 * Transporte de las operaciones de HU026 del contrato bff-web 0.23.0 (ver
 * `contract.ts`, ADR-041): `POST /v1/routes` (`publish_route_v1_routes_post`),
 * `POST /v1/routes/{route_id}/retire` (`retire_route_v1_routes__route_id__retire_post`)
 * y `GET /v1/me/routes` (`my_routes_v1_me_routes_get`). Solo `organizer` con
 * `training.routes.author`; el organizador sale del token. Estos tipos son del
 * transporte: la interfaz los transforma antes de usarlos.
 */

/** Esquema `Sport`: el catálogo de deportes de HU010. */
export const ROUTE_SPORTS = SPORTS;
export type RouteSportDto = SportDto;

/** Esquema `Difficulty`. */
export const ROUTE_DIFFICULTIES = ['LOW', 'MODERATE', 'HIGH'] as const;
export type RouteDifficultyDto = (typeof ROUTE_DIFFICULTIES)[number];

/** Enumeración `status` de `RouteResponse`. */
export const ROUTE_STATUSES = ['PUBLISHED', 'RETIRED'] as const;
export type RouteStatusDto = (typeof ROUTE_STATUSES)[number];

/** Esquemas `RoutePointRequest` y `RoutePoint`, en grados decimales. */
export interface RoutePointDto {
  readonly lat: number;
  readonly lng: number;
}

/** Esquema `PublishRouteRequest`: sin `organizer_id` ni campos adicionales. */
export interface PublishRouteRequestDto {
  readonly name: string;
  /** Opcional; `null` si no se indica. */
  readonly description: string | null;
  readonly sport: RouteSportDto;
  /** Cadena decimal (`"12.5"`), de 0.1 a 500.0 con un decimal. */
  readonly distance_km: string;
  readonly difficulty: RouteDifficultyDto;
  readonly city: string;
  /** ISO 3166-1 alfa-2 en mayúsculas. */
  readonly country_code: string;
  readonly start_point: RoutePointDto;
  /** Puntos intermedios opcionales, en orden; sin trazado GPX. */
  readonly waypoints: readonly RoutePointDto[];
}

/** Esquema `RetireRouteRequest`. */
export interface RetireRouteRequestDto {
  /** Versión vigente que conoce el cliente. */
  readonly expected_version: number;
}

/** Esquema `RouteResponse`. */
export interface RouteResponseDto {
  readonly route_id: string;
  readonly organizer_id: string;
  readonly name: string;
  readonly description: string | null;
  readonly sport: RouteSportDto;
  /** Cadena con exactamente un decimal. */
  readonly distance_km: string;
  readonly difficulty: RouteDifficultyDto;
  readonly city: string;
  readonly country_code: string;
  readonly start_point: RoutePointDto;
  readonly waypoints: readonly RoutePointDto[];
  readonly source: 'ORGANIZER';
  readonly status: RouteStatusDto;
  readonly version: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly published_at: string;
  readonly retired_at: string | null;
}

/** Esquema `RoutesResponse`: orden `created_at` y `route_id` descendentes. */
export interface RoutesResponseDto {
  readonly items: readonly RouteResponseDto[];
  readonly next_cursor: string | null;
}

/** Parámetros de `GET /v1/me/routes`; los ausentes no se envían. */
export interface MyRoutesQueryDto {
  /** 1–50; el BFF usa 20 si no se envía. */
  readonly limit?: number | null;
  /** Cursor opaco de `next_cursor`; la web nunca lo interpreta. */
  readonly cursor?: string | null;
}

/** Límites del contrato (`PublishRouteRequest`, `GET /v1/me/routes`). */
export const ROUTE_LIMITS = {
  nameMin: 3,
  nameMax: 120,
  descriptionMax: 2000,
  cityMin: 2,
  cityMax: 80,
  distanceMin: '0.1',
  distanceMax: '500.0',
  latMin: -90,
  latMax: 90,
  lngMin: -180,
  lngMax: 180,
  waypointsMax: 200,
  listMin: 1,
  listMax: 50,
  listDefault: 20,
} as const;

/** Patrón de `country_code` en el contrato. */
export const ROUTE_COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;

/** Cabecera de respuesta que marca el resultado de un reintento idempotente. */
export const ROUTE_IDEMPOTENT_REPLAYED_HEADER = 'Idempotent-Replayed';

/** Códigos de error de `POST /v1/routes`. */
export const PUBLISH_ROUTE_ERROR_CODES = {
  invalidAccessToken: 'invalid_access_token',
  permissionRequired: 'permission_required',
  idempotencyKeyReused: 'idempotency_key_reused',
  validationError: 'validation_error',
  upstreamUnavailable: 'upstream_unavailable',
  upstreamTimeout: 'upstream_timeout',
} as const;

/** Códigos de error de `POST /v1/routes/{route_id}/retire`. */
export const RETIRE_ROUTE_ERROR_CODES = {
  invalidAccessToken: 'invalid_access_token',
  permissionRequired: 'permission_required',
  routeNotFound: 'route_not_found',
  versionConflict: 'version_conflict',
  validationError: 'validation_error',
  upstreamUnavailable: 'upstream_unavailable',
  upstreamTimeout: 'upstream_timeout',
} as const;

/** Códigos de error de `GET /v1/me/routes`. */
export const MY_ROUTES_ERROR_CODES = {
  invalidAccessToken: 'invalid_access_token',
  permissionRequired: 'permission_required',
  validationError: 'validation_error',
  upstreamUnavailable: 'upstream_unavailable',
  upstreamTimeout: 'upstream_timeout',
} as const;

/** Cliente del BFF web para las rutas del organizador (HU026). */
@Injectable({ providedIn: 'root' })
export class BffWebRoutesApi {
  private readonly http = inject(HttpClient);
  private readonly bffWebUrl = inject(BffWebUrl);

  /**
   * Publica una ruta (nace `PUBLISHED`). Se devuelve la respuesta completa para
   * leer `Idempotent-Replayed`.
   *
   * @param idempotencyKey UUID obligatorio; igual en los reintentos del mismo intento lógico.
   */
  publishRoute(
    accessToken: string,
    body: PublishRouteRequestDto,
    idempotencyKey: string,
  ): Observable<HttpResponse<RouteResponseDto>> {
    return this.http.post<RouteResponseDto>(this.bffWebUrl.resolve('v1/routes'), body, {
      headers: bearer(accessToken).set('Idempotency-Key', idempotencyKey),
      observe: 'response',
    });
  }

  /** Retira una ruta propia: `PUBLISHED` → `RETIRED`; una ya retirada se devuelve tal cual. */
  retireRoute(
    accessToken: string,
    routeId: string,
    body: RetireRouteRequestDto,
  ): Observable<RouteResponseDto> {
    return this.http.post<RouteResponseDto>(
      this.bffWebUrl.resolve(`v1/routes/${encodeURIComponent(routeId)}/retire`),
      body,
      { headers: bearer(accessToken) },
    );
  }

  /** Rutas publicadas y retiradas del organizador de la sesión. */
  getMyRoutes(accessToken: string, query: MyRoutesQueryDto): Observable<RoutesResponseDto> {
    let params = new HttpParams({ encoder: STRICT_CODEC });
    for (const [name, value] of Object.entries(query)) {
      if (value !== null && value !== undefined && value !== '') {
        params = params.set(name, String(value));
      }
    }
    return this.http.get<RoutesResponseDto>(this.bffWebUrl.resolve('v1/me/routes'), {
      headers: bearer(accessToken),
      params,
    });
  }
}

function bearer(accessToken: string): HttpHeaders {
  return new HttpHeaders({ Authorization: `Bearer ${accessToken}` });
}
