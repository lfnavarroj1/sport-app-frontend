import { HttpClient, HttpHeaders, HttpParams, HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { BffWebUrl } from '../bff-web-url';
import {
  AvailabilityIntervalDto,
  ServiceCategoryDto,
  ServiceModalityDto,
  ServicePriceDto,
} from './services-availability.api';
import { STRICT_CODEC } from './training-history.api';

/**
 * Transporte de los servicios propios del profesional en el contrato bff-web
 * 0.16.0 (ver `contract.ts`), conforme a ADR-027: `POST /v1/services`
 * (operationId `create_v1_services_post`, HU015) y, para HU019,
 * `GET /v1/me/services`, `GET /v1/me/services/{service_id}` y
 * `POST /v1/services/{service_id}/publish`. Solo `service_provider`; se
 * autentica con el access token y `provider_id` sale del token: nunca viaja en
 * la solicitud. Estos tipos son del transporte: la interfaz los transforma antes
 * de usarlos.
 */

/** Esquema `CreateServiceRequest`: exactamente los campos de ADR-027. */
export interface CreateServiceRequestDto {
  readonly name: string;
  readonly description: string;
  readonly category: ServiceCategoryDto;
  readonly modality: ServiceModalityDto;
  readonly price: ServicePriceDto;
  /**
   * Opcional (se omite si no hay intervalos). En la solicitud, cada instante
   * lleva el desfase de `time_zone` en ese momento.
   */
  readonly availability?: readonly AvailabilityIntervalDto[];
}

/** Esquema `ServiceResponse`: servicio confirmado, instantes en UTC (`Z`). */
export interface ServiceResponseDto {
  readonly service_id: string;
  readonly provider_id: string;
  readonly name: string;
  readonly description: string;
  readonly category: ServiceCategoryDto;
  readonly modality: ServiceModalityDto;
  readonly price: ServicePriceDto;
  readonly availability: readonly AvailabilityIntervalDto[];
  readonly status: 'DRAFT' | 'PUBLISHED';
  readonly version: number;
  readonly created_at: string;
  readonly updated_at: string;
  /** `null` mientras está en borrador. */
  readonly published_at: string | null;
}

/** Límites de `CreateServiceRequest` y `AvailabilityInterval` en el contrato (ADR-027). */
export const CREATE_SERVICE_LIMITS = {
  nameMin: 3,
  nameMax: 120,
  descriptionMin: 20,
  descriptionMax: 2000,
  intervalsMax: 100,
  capacityMin: 1,
  capacityMax: 100,
} as const;

/** Patrón de `price.amount`: cadena decimal de 0.00 a 999999999.99, hasta dos decimales. */
export const SERVICE_AMOUNT_PATTERN = /^\d{1,9}(\.\d{1,2})?$/;

/** Única moneda del MVP (`price.currency`, ADR-027 decisión 1). */
export const SERVICE_CURRENCY = 'COP';

/** Códigos de error que el contrato declara para `POST /v1/services`. */
export const CREATE_SERVICE_ERROR_CODES = {
  invalidAccessToken: 'invalid_access_token',
  permissionRequired: 'permission_required',
  idempotencyKeyReused: 'idempotency_key_reused',
  validationError: 'validation_error',
  upstreamUnavailable: 'upstream_unavailable',
  upstreamTimeout: 'upstream_timeout',
} as const;

/**
 * Catálogo estable de `details[].issue` de `validation_error` para HU015
 * (ADR-027, decisión 14). El OpenAPI lo referencia como «ADR-027».
 */
export const CREATE_SERVICE_ISSUES = [
  'required',
  'field_not_allowed',
  'unsupported_currency',
  'out_of_range',
  'too_many_decimals',
  'invalid_length',
  'unknown_value',
  'not_in_future',
  'ends_before_starts',
  'overlapping_interval',
  'time_zone_unknown',
  'time_zone_offset_mismatch',
  'too_many_intervals',
] as const;

/** Cabecera de respuesta que marca el resultado de un reintento idempotente. */
export const SERVICE_IDEMPOTENT_REPLAYED_HEADER = 'Idempotent-Replayed';

/** Enumeración `status` del servicio (ADR-027): la única transición es `DRAFT` → `PUBLISHED`. */
export type ServiceStatusDto = ServiceResponseDto['status'];

/** Esquema `MyServicesResponse` de `GET /v1/me/services`. */
export interface MyServicesResponseDto {
  readonly items: readonly ServiceResponseDto[];
  /** Cursor opaco de la página siguiente; `null` si no hay más. */
  readonly next_cursor: string | null;
}

/** Parámetros de `GET /v1/me/services`; los ausentes no se envían. */
export interface MyServicesQueryDto {
  /** Sin él, el BFF devuelve `DRAFT` y `PUBLISHED`. */
  readonly status?: ServiceStatusDto | null;
  /** 1–100; el BFF usa 20 si no se envía. */
  readonly limit?: number | null;
  /** Cursor opaco de `next_cursor`; la web nunca lo interpreta. */
  readonly cursor?: string | null;
}

/** Esquema `PublishServiceResponse`: estado, versión y marcas de tiempo en UTC (`Z`). */
export interface PublishServiceResponseDto {
  readonly service_id: string;
  readonly provider_id: string;
  readonly status: 'PUBLISHED';
  readonly version: number;
  readonly published_at: string;
  readonly updated_at: string;
}

/** Límites del parámetro `limit` de `GET /v1/me/services`. */
export const MY_SERVICES_LIMIT = { min: 1, max: 100, default: 20 } as const;

/** Códigos de error que el contrato declara para `GET /v1/me/services`. */
export const MY_SERVICES_ERROR_CODES = {
  invalidAccessToken: 'invalid_access_token',
  permissionRequired: 'permission_required',
  validationError: 'validation_error',
  upstreamUnavailable: 'upstream_unavailable',
  upstreamTimeout: 'upstream_timeout',
} as const;

/** Códigos de error que el contrato declara para `GET /v1/me/services/{service_id}`. */
export const MY_SERVICE_ERROR_CODES = {
  invalidAccessToken: 'invalid_access_token',
  permissionRequired: 'permission_required',
  serviceNotFound: 'service_not_found',
  validationError: 'validation_error',
  upstreamUnavailable: 'upstream_unavailable',
  upstreamTimeout: 'upstream_timeout',
} as const;

/** Códigos de error que el contrato declara para `POST /v1/services/{service_id}/publish`. */
export const PUBLISH_SERVICE_ERROR_CODES = {
  invalidAccessToken: 'invalid_access_token',
  permissionRequired: 'permission_required',
  serviceNotFound: 'service_not_found',
  idempotencyKeyReused: 'idempotency_key_reused',
  validationError: 'validation_error',
  upstreamUnavailable: 'upstream_unavailable',
  upstreamTimeout: 'upstream_timeout',
} as const;

@Injectable({ providedIn: 'root' })
export class BffWebServicesApi {
  private readonly http = inject(HttpClient);
  private readonly bffWebUrl = inject(BffWebUrl);

  /**
   * Crea el servicio en borrador. Se devuelve la respuesta completa para leer
   * `Idempotent-Replayed`.
   *
   * @param idempotencyKey UUID (`Idempotency-Key`); igual en todos los reintentos
   * del mismo intento lógico (ADR-027, decisión 12).
   */
  createService(
    accessToken: string,
    body: CreateServiceRequestDto,
    idempotencyKey: string,
  ): Observable<HttpResponse<ServiceResponseDto>> {
    return this.http.post<ServiceResponseDto>(this.bffWebUrl.resolve('v1/services'), body, {
      headers: new HttpHeaders({
        Authorization: `Bearer ${accessToken}`,
        'Idempotency-Key': idempotencyKey,
      }),
      observe: 'response',
    });
  }

  /** Servicios propios del profesional de la sesión (HU019, ADR-038). */
  getMyServices(accessToken: string, query: MyServicesQueryDto): Observable<MyServicesResponseDto> {
    let params = new HttpParams({ encoder: STRICT_CODEC });
    for (const [name, value] of Object.entries(query)) {
      if (value !== null && value !== undefined && value !== '') {
        params = params.set(name, String(value));
      }
    }
    return this.http.get<MyServicesResponseDto>(this.bffWebUrl.resolve('v1/me/services'), {
      headers: bearer(accessToken),
      params,
    });
  }

  /** Servicio propio completo; uno ajeno o inexistente responde `404 service_not_found`. */
  getMyService(accessToken: string, serviceId: string): Observable<ServiceResponseDto> {
    return this.http.get<ServiceResponseDto>(
      this.bffWebUrl.resolve(`v1/me/services/${encodeURIComponent(serviceId)}`),
      { headers: bearer(accessToken) },
    );
  }

  /**
   * Publica el servicio (sin cuerpo). Se devuelve la respuesta completa para leer
   * `Idempotent-Replayed`.
   *
   * @param idempotencyKey UUID (`Idempotency-Key`); igual en todos los reintentos
   * del mismo intento lógico (ADR-027, contrato de publicación de HU019).
   */
  publishService(
    accessToken: string,
    serviceId: string,
    idempotencyKey: string,
  ): Observable<HttpResponse<PublishServiceResponseDto>> {
    return this.http.post<PublishServiceResponseDto>(
      this.bffWebUrl.resolve(`v1/services/${encodeURIComponent(serviceId)}/publish`),
      null,
      {
        headers: new HttpHeaders({
          Authorization: `Bearer ${accessToken}`,
          'Idempotency-Key': idempotencyKey,
        }),
        observe: 'response',
      },
    );
  }
}

function bearer(accessToken: string): HttpHeaders {
  return new HttpHeaders({ Authorization: `Bearer ${accessToken}` });
}
