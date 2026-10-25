import { HttpClient, HttpHeaders, HttpParams, HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { BffWebUrl } from '../bff-web-url';

/**
 * Transporte de las operaciones de HU016 del contrato bff-web 0.20.0 (ver
 * `contract.ts`, ADR-036): catálogo de planes con ofertas, suscripción vigente y
 * cambio de plan, solo para `athlete`; y la de HU007 (contrato 0.27.0 o superior),
 * el estado de cuenta, para los tres actores. Todas se autentican con el access
 * token (`Authorization: Bearer`). Estos tipos son del transporte: la interfaz los
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

/** Enumeración `statement_status` de `AccountStatementResponse` (HU007). */
export const STATEMENT_STATUSES = ['ACTIVE', 'PROVISIONING', 'NOT_APPLICABLE', 'NONE'] as const;
export type StatementStatusDto = (typeof STATEMENT_STATUSES)[number];

/** Enumeración `status` de `CommitmentItem`. */
export const COMMITMENT_STATUSES = ['PENDING_EXTERNAL', 'WAIVED'] as const;
export type CommitmentStatusDto = (typeof COMMITMENT_STATUSES)[number];

/** Enumeración `movement_type` de `MovementItem`. */
export const MOVEMENT_TYPES = [
  'FREE_ACTIVATED',
  'PLAN_CHANGED',
  'RETURNED_TO_FREE',
  'COMMITMENT_CREATED',
  'COMMITMENT_WAIVED',
] as const;
export type MovementTypeDto = (typeof MOVEMENT_TYPES)[number];

/**
 * Esquema `CommitmentItem`: compromiso de pago informativo; SportApp no lo cobra
 * ni lo marca pagado. `amount` es una cadena decimal en COP antes de impuestos.
 */
export interface CommitmentItemDto {
  readonly commitment_id: string;
  readonly plan_code: string;
  readonly periodicity: Exclude<PeriodicityDto, 'NONE'>;
  readonly amount: string;
  readonly currency: 'COP';
  readonly period_start: string;
  readonly period_end: string;
  readonly due_at: string;
  readonly status: CommitmentStatusDto;
}

/** Esquema `MovementItem`: `amount`, `currency` y `commitment_id` solo en los del compromiso. */
export interface MovementItemDto {
  readonly movement_id: string;
  readonly movement_type: MovementTypeDto;
  readonly occurred_at: string;
  readonly subscription_id: string;
  readonly plan_code: string;
  readonly periodicity: PeriodicityDto;
  readonly commitment_id: string | null;
  readonly amount: string | null;
  readonly currency: 'COP' | null;
}

/** Esquema `AccountStatementResponse`: sin pagos (`NOT_INTEGRATED`, `balance` siempre `null`). */
export interface AccountStatementResponseDto {
  readonly statement_status: StatementStatusDto;
  /** La vigente, como `GET /v1/me/subscription`; `null` sin suscripción activa. */
  readonly subscription: SubscriptionResponseDto | null;
  readonly commitments: readonly CommitmentItemDto[];
  /** Página de movimientos, orden `occurred_at DESC, movement_id DESC`. */
  readonly movements: readonly MovementItemDto[];
  /** Cursor opaco de la página siguiente; `null` si no hay más. */
  readonly next_cursor: string | null;
  readonly payments_status: 'NOT_INTEGRATED';
  readonly balance: null;
}

/** Códigos de error de `GET /v1/me/account-statement`. */
export const ACCOUNT_STATEMENT_ERROR_CODES = {
  invalidAccessToken: 'invalid_access_token',
  permissionRequired: 'permission_required',
  validationError: 'validation_error',
  upstreamUnavailable: 'upstream_unavailable',
  upstreamTimeout: 'upstream_timeout',
} as const;

/**
 * Cliente del BFF web para «Mi plan» (HU016) y el estado de cuenta (HU007, contrato
 * bff-web 0.27.0 o superior). Quien consulta sale del access token.
 */
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

  /**
   * Estado de cuenta propio (HU007): suscripción vigente, compromisos informativos y
   * una página de movimientos. Sin efectos.
   *
   * @param cursor `next_cursor` de la página anterior, sin modificar; `null` para la primera.
   * @param limit 1 a 100.
   */
  getAccountStatement(
    accessToken: string,
    cursor: string | null,
    limit: number,
  ): Observable<AccountStatementResponseDto> {
    let params = new HttpParams().set('limit', String(limit));
    if (cursor !== null) {
      params = params.set('cursor', cursor);
    }
    return this.http.get<AccountStatementResponseDto>(
      this.bffWebUrl.resolve('v1/me/account-statement'),
      { headers: bearer(accessToken), params },
    );
  }
}

function bearer(accessToken: string): HttpHeaders {
  return new HttpHeaders({ Authorization: `Bearer ${accessToken}` });
}
