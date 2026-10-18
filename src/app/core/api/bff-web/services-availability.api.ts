import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { BffWebUrl } from '../bff-web-url';
import { STRICT_CODEC } from './training-history.api';

/**
 * Transporte de `GET /v1/services/availability` (operationId
 * `availability_v1_services_availability_get`) del contrato bff-web 0.15.0 (ver
 * `contract.ts`), conforme a ADR-038 y ADR-027 (HU020). Solo `athlete`; se
 * autentica con el access token. Estos tipos son del transporte: la interfaz los
 * transforma antes de usarlos.
 */

/** Enumeración `category` de `CatalogService`. */
export const SERVICE_CATEGORIES = [
  'SPORTS_MEDICINE',
  'COACHING',
  'NUTRITION',
  'TRANSPORT',
  'ACCOMPANIMENT',
] as const;
export type ServiceCategoryDto = (typeof SERVICE_CATEGORIES)[number];

/** Enumeración `modality` de `CatalogService`. */
export const SERVICE_MODALITIES = ['IN_PERSON', 'VIRTUAL', 'HYBRID'] as const;
export type ServiceModalityDto = (typeof SERVICE_MODALITIES)[number];

/** Enumeración `billing_unit` de `ServicePrice`. */
export const BILLING_UNITS = ['SERVICE', 'SESSION', 'HOUR', 'DAY'] as const;
export type BillingUnitDto = (typeof BILLING_UNITS)[number];

/** Valores de `availability` en la consulta. */
export const AVAILABILITY_MODES = ['available', 'all'] as const;
export type AvailabilityModeDto = (typeof AVAILABILITY_MODES)[number];

/** Límites de la consulta: periodo de hasta 31 días y página de 1 a 50 (20 por defecto). */
export const SERVICES_AVAILABILITY_LIMITS = {
  maxPeriodDays: 31,
  pageMin: 1,
  pageMax: 50,
  pageDefault: 20,
} as const;

/** Parámetros de la consulta; los ausentes no se envían. */
export interface ServicesAvailabilityQueryDto {
  /** Instante ISO 8601 con desfase; obligatorio. */
  readonly from: string;
  /** Instante ISO 8601 con desfase; obligatorio. Periodo `[from, to)` de hasta 31 días. */
  readonly to: string;
  /** Repetible: se envía un parámetro por categoría. */
  readonly category?: readonly ServiceCategoryDto[];
  /** Repetible: se envía un parámetro por modalidad. */
  readonly modality?: readonly ServiceModalityDto[];
  readonly availability?: AvailabilityModeDto;
  readonly limit?: number;
  /** `next_cursor` anterior, sin modificar. */
  readonly cursor?: string | null;
}

/** Esquema `ServicePrice`: precio público de referencia, no es un cobro. */
export interface ServicePriceDto {
  /** Cadena decimal de 0.00 a 999999999.99. */
  readonly amount: string;
  readonly currency: 'COP';
  readonly billing_unit: BillingUnitDto;
}

/** Esquema `AvailabilityInterval`: `[starts_at, ends_at)` en UTC (`Z`) con la zona del servicio. */
export interface AvailabilityIntervalDto {
  readonly starts_at: string;
  readonly ends_at: string;
  readonly time_zone: string;
  readonly capacity: number;
}

/** Esquema `CatalogService`. */
export interface CatalogServiceDto {
  readonly service_id: string;
  readonly provider_id: string;
  readonly name: string;
  readonly description: string;
  readonly category: ServiceCategoryDto;
  readonly modality: ServiceModalityDto;
  readonly price: ServicePriceDto;
  readonly availability: readonly AvailabilityIntervalDto[];
  /** `false` solo con `availability=all` y sin intervalos en el periodo. */
  readonly available: boolean;
}

/** Esquema `ServiceAvailabilityResponse`. */
export interface ServiceAvailabilityResponseDto {
  readonly items: readonly CatalogServiceDto[];
  readonly next_cursor: string | null;
  /** Categorías omitidas por falta de capacidad del plan (`["SPORTS_MEDICINE"]`). */
  readonly restricted_categories: readonly ServiceCategoryDto[];
}

/** Códigos de error que el contrato declara para la consulta. */
export const SERVICES_AVAILABILITY_ERROR_CODES = {
  invalidAccessToken: 'invalid_access_token',
  permissionRequired: 'permission_required',
  validationError: 'validation_error',
  upstreamUnavailable: 'upstream_unavailable',
  upstreamTimeout: 'upstream_timeout',
} as const;

/** Cliente del BFF web para la disponibilidad de servicios (HU020). */
@Injectable({ providedIn: 'root' })
export class BffWebServicesAvailabilityApi {
  private readonly http = inject(HttpClient);
  private readonly bffWebUrl = inject(BffWebUrl);

  getAvailability(
    accessToken: string,
    query: ServicesAvailabilityQueryDto,
  ): Observable<ServiceAvailabilityResponseDto> {
    return this.http.get<ServiceAvailabilityResponseDto>(
      this.bffWebUrl.resolve('v1/services/availability'),
      {
        headers: new HttpHeaders({ Authorization: `Bearer ${accessToken}` }),
        params: toParams(query),
      },
    );
  }
}

function toParams(query: ServicesAvailabilityQueryDto): HttpParams {
  let params = new HttpParams({ encoder: STRICT_CODEC })
    .set('from', query.from)
    .set('to', query.to);
  for (const category of query.category ?? []) {
    params = params.append('category', category);
  }
  for (const modality of query.modality ?? []) {
    params = params.append('modality', modality);
  }
  if (query.availability) {
    params = params.set('availability', query.availability);
  }
  if (query.limit !== undefined) {
    params = params.set('limit', String(query.limit));
  }
  if (query.cursor) {
    params = params.set('cursor', query.cursor);
  }
  return params;
}
