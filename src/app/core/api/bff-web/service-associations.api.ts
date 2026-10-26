import { HttpClient, HttpHeaders, HttpParams, HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { BffWebUrl } from '../bff-web-url';
import {
  ServiceCategoryDto,
  ServiceModalityDto,
  ServicePriceDto,
} from './services-availability.api';
import { STRICT_CODEC } from './training-history.api';

/**
 * Transporte de las operaciones de HU017 del contrato bff-web 0.25.0 (ver
 * `contract.ts`, ADR-038): `POST /v1/me/service-associations`
 * (`associate_v1_me_service_associations_post`), `DELETE
 * /v1/me/service-associations/{association_id}`
 * (`dissociate_v1_me_service_associations__association_id__delete`) y `GET
 * /v1/me/service-associations` (`list_mine_v1_me_service_associations_get`). Solo
 * `athlete` con `services.sports_medicine.access`; el deportista sale del token.
 * Asociar no comparte datos de salud, no contrata, no reserva ni paga. Estos tipos
 * son del transporte: la interfaz los transforma antes de usarlos.
 */

/** Cabecera que marca la respuesta de un reintento con la misma clave. */
export const ASSOCIATION_IDEMPOTENT_REPLAYED_HEADER = 'Idempotent-Replayed';

/** Enumeración `status` de `ServiceAssociationResponse`. */
export const ASSOCIATION_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type AssociationStatusDto = (typeof ASSOCIATION_STATUSES)[number];

/** Valores de `status` en la consulta: `ACTIVE` por defecto; `ALL` incluye el historial. */
export const ASSOCIATION_STATUS_FILTERS = ['ACTIVE', 'INACTIVE', 'ALL'] as const;
export type AssociationStatusFilterDto = (typeof ASSOCIATION_STATUS_FILTERS)[number];

/** Límites de la consulta: página de 1 a 100, 20 por defecto. */
export const SERVICE_ASSOCIATIONS_LIMITS = {
  listMin: 1,
  listMax: 100,
  listDefault: 20,
} as const;

/** Cuerpo `AssociateServiceRequest`. */
export interface AssociateServiceRequestDto {
  readonly service_id: string;
}

/** Esquema `AssociatedServiceSummary`; la tarifa es informativa. */
export interface AssociatedServiceSummaryDto {
  readonly name: string;
  readonly category: ServiceCategoryDto;
  readonly modality: ServiceModalityDto;
  readonly fee: ServicePriceDto;
}

/** Esquema `ServiceAssociationResponse`. */
export interface ServiceAssociationResponseDto {
  readonly association_id: string;
  readonly service_id: string;
  readonly service: AssociatedServiceSummaryDto;
  readonly status: AssociationStatusDto;
  /** UTC (`Z`). */
  readonly associated_at: string;
  /** UTC (`Z`); `null` mientras está activa. */
  readonly ended_at: string | null;
  readonly version: number;
}

/** Esquema `ServiceAssociationsResponse`. */
export interface ServiceAssociationsResponseDto {
  readonly items: readonly ServiceAssociationResponseDto[];
  readonly next_cursor: string | null;
}

/** Parámetros de la consulta; los ausentes no se envían. */
export interface ServiceAssociationsQueryDto {
  readonly status?: AssociationStatusFilterDto;
  readonly limit?: number;
  /** `next_cursor` anterior, sin modificar. */
  readonly cursor?: string | null;
}

/** Códigos de error de `POST /v1/me/service-associations`. */
export const ASSOCIATE_SERVICE_ERROR_CODES = {
  invalidAccessToken: 'invalid_access_token',
  permissionRequired: 'permission_required',
  capabilityRequired: 'capability_required',
  serviceNotFound: 'service_not_found',
  associationExists: 'association_exists',
  idempotencyKeyReused: 'idempotency_key_reused',
  validationError: 'validation_error',
  upstreamUnavailable: 'upstream_unavailable',
  upstreamTimeout: 'upstream_timeout',
} as const;

/** Códigos de error de `DELETE /v1/me/service-associations/{association_id}`. */
export const DISSOCIATE_SERVICE_ERROR_CODES = {
  invalidAccessToken: 'invalid_access_token',
  permissionRequired: 'permission_required',
  capabilityRequired: 'capability_required',
  associationNotFound: 'association_not_found',
  validationError: 'validation_error',
  upstreamUnavailable: 'upstream_unavailable',
  upstreamTimeout: 'upstream_timeout',
} as const;

/** Códigos de error de `GET /v1/me/service-associations`. */
export const SERVICE_ASSOCIATIONS_ERROR_CODES = {
  invalidAccessToken: 'invalid_access_token',
  permissionRequired: 'permission_required',
  capabilityRequired: 'capability_required',
  validationError: 'validation_error',
  upstreamUnavailable: 'upstream_unavailable',
  upstreamTimeout: 'upstream_timeout',
} as const;

/** Cliente del BFF web para las asociaciones a servicios médicos deportivos (HU017). */
@Injectable({ providedIn: 'root' })
export class BffWebServiceAssociationsApi {
  private readonly http = inject(HttpClient);
  private readonly bffWebUrl = inject(BffWebUrl);

  /**
   * Asocia un servicio médico deportivo publicado. Se devuelve la respuesta
   * completa para leer `Idempotent-Replayed`.
   *
   * @param idempotencyKey UUID obligatorio; igual en los reintentos del mismo intento lógico.
   */
  associate(
    accessToken: string,
    body: AssociateServiceRequestDto,
    idempotencyKey: string,
  ): Observable<HttpResponse<ServiceAssociationResponseDto>> {
    return this.http.post<ServiceAssociationResponseDto>(
      this.bffWebUrl.resolve('v1/me/service-associations'),
      body,
      { headers: bearer(accessToken).set('Idempotency-Key', idempotencyKey), observe: 'response' },
    );
  }

  /** Quita una asociación propia (`204`, también si ya estaba inactiva). */
  dissociate(accessToken: string, associationId: string): Observable<void> {
    return this.http.delete<void>(
      this.bffWebUrl.resolve(`v1/me/service-associations/${encodeURIComponent(associationId)}`),
      { headers: bearer(accessToken) },
    );
  }

  /** Asociaciones propias, de la más reciente a la más antigua. */
  listMine(
    accessToken: string,
    query: ServiceAssociationsQueryDto,
  ): Observable<ServiceAssociationsResponseDto> {
    let params = new HttpParams({ encoder: STRICT_CODEC });
    for (const [name, value] of Object.entries(query)) {
      if (value !== null && value !== undefined && value !== '') {
        params = params.set(name, String(value));
      }
    }
    return this.http.get<ServiceAssociationsResponseDto>(
      this.bffWebUrl.resolve('v1/me/service-associations'),
      { headers: bearer(accessToken), params },
    );
  }
}

function bearer(accessToken: string): HttpHeaders {
  return new HttpHeaders({ Authorization: `Bearer ${accessToken}` });
}
