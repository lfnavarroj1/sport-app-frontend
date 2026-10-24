import { HttpClient, HttpHeaders, HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { BffWebUrl } from '../bff-web-url';

/**
 * Transporte de las operaciones de HU016 del contrato bff-web 0.20.0 (ver
 * `contract.ts`, ADR-036): catálogo de planes con ofertas, suscripción vigente y
 * cambio de plan. Solo `athlete`; todas se autentican con el access token
 * (`Authorization: Bearer`). Estos tipos son del transporte: la interfaz los
 * transforma antes de usarlos.
 */

/** Enumeración de periodicidades de `PlanOfferResponse` y `SubscriptionChangeRequest`. */
export const PERIODICITIES = ['NONE', 'MONTHLY', 'QUARTERLY', 'ANNUAL'] as const;
export type PeriodicityDto = (typeof PERIODICITIES)[number];

/** Enumeración `status` de `SubscriptionResponse`. */
export const SUBSCRIPTION_STATUSES = ['ACTIVE', 'PROVISIONING'] as const;
export type SubscriptionStatusDto = (typeof SUBSCRIPTION_STATUSES)[number];

/** Esquema `PlanOfferResponse`: `price` es una cadena decimal con dos decimales en COP. */
export interface PlanOfferDto {
  readonly periodicity: PeriodicityDto;
  readonly price: string;
  readonly currency: 'COP';
  readonly duration_months: number | null;
}

/** Esquema `PlanResponse`: `capabilities` ya incluye las heredadas. */
export interface PlanDto {
  readonly plan_code: string;
  readonly name: string;
  readonly description: string;
  readonly level: number;
  readonly version: number;
  readonly selectable: boolean;
  readonly capabilities: readonly string[];
  readonly offers: readonly PlanOfferDto[];
}

/** Esquema `PlansResponse`. */
export interface PlansResponseDto {
  readonly catalog_version: string;
  /** `null` en `PROVISIONING`. */
  readonly current_plan_code: string | null;
  readonly plans: readonly PlanDto[];
}

/** Esquema `SubscriptionResponse`: en `PROVISIONING` los demás campos son `null`. */
export interface SubscriptionResponseDto {
  readonly subscription_id: string | null;
  readonly plan_code: string | null;
  readonly plan_version: number | null;
  readonly periodicity: PeriodicityDto | null;
  readonly price: string | null;
  readonly period_start: string | null;
  readonly period_end: string | null;
  readonly status: SubscriptionStatusDto;
  readonly origin: 'AUTO_REGISTRATION' | 'USER_CHANGE' | null;
  readonly version: number | null;
}

/** Esquema `SubscriptionChangeRequest`. */
export interface SubscriptionChangeRequestDto {
  readonly plan_code: string;
  readonly periodicity: PeriodicityDto;
  /** `version` de la suscripción vigente. */
  readonly expected_subscription_version: number;
}

/** Cabecera de respuesta que marca el resultado de un reintento idempotente. */
export const SUBSCRIPTION_IDEMPOTENT_REPLAYED_HEADER = 'Idempotent-Replayed';

/** Códigos de error de `GET /v1/plans` y `GET /v1/me/subscription`. */
export const AFFILIATION_QUERY_ERROR_CODES = {
  invalidAccessToken: 'invalid_access_token',
  permissionRequired: 'permission_required',
  upstreamUnavailable: 'upstream_unavailable',
  upstreamTimeout: 'upstream_timeout',
} as const;

/** Códigos de error de `POST /v1/me/subscription/changes`. */
export const SUBSCRIPTION_CHANGE_ERROR_CODES = {
  invalidAccessToken: 'invalid_access_token',
  permissionRequired: 'permission_required',
  planNotFound: 'plan_not_found',
  planNotSelectable: 'plan_not_selectable',
  subscriptionUnchanged: 'subscription_unchanged',
  subscriptionProvisioning: 'subscription_provisioning',
  versionConflict: 'version_conflict',
  idempotencyKeyReused: 'idempotency_key_reused',
  validationError: 'validation_error',
  upstreamUnavailable: 'upstream_unavailable',
  upstreamTimeout: 'upstream_timeout',
} as const;

/** Cliente del BFF web para «Mi plan» (HU016). El deportista sale del access token. */
@Injectable({ providedIn: 'root' })
export class BffWebAffiliationApi {
  private readonly http = inject(HttpClient);
  private readonly bffWebUrl = inject(BffWebUrl);

  /** Catálogo vigente con capacidades y ofertas, y el plan actual de quien consulta. */
  getPlans(accessToken: string): Observable<PlansResponseDto> {
    return this.http.get<PlansResponseDto>(this.bffWebUrl.resolve('v1/plans'), {
      headers: bearer(accessToken),
    });
  }

  /** Suscripción vigente del deportista. */
  getSubscription(accessToken: string): Observable<SubscriptionResponseDto> {
    return this.http.get<SubscriptionResponseDto>(this.bffWebUrl.resolve('v1/me/subscription'), {
      headers: bearer(accessToken),
    });
  }

  /**
   * Cambia el plan de inmediato. Se devuelve la respuesta completa para leer
   * `Idempotent-Replayed`.
   *
   * @param idempotencyKey UUID obligatorio (`Idempotency-Key`); igual en los
   * reintentos del mismo intento lógico.
   */
  changeSubscription(
    accessToken: string,
    body: SubscriptionChangeRequestDto,
    idempotencyKey: string,
  ): Observable<HttpResponse<SubscriptionResponseDto>> {
    return this.http.post<SubscriptionResponseDto>(
      this.bffWebUrl.resolve('v1/me/subscription/changes'),
      body,
      {
        headers: bearer(accessToken).set('Idempotency-Key', idempotencyKey),
        observe: 'response',
      },
    );
  }
}

function bearer(accessToken: string): HttpHeaders {
  return new HttpHeaders({ Authorization: `Bearer ${accessToken}` });
}
