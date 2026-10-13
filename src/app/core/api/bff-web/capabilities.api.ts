import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { BffWebUrl } from '../bff-web-url';
import { ActorTypeDto } from './contract';

/** Enumeración `subscription_status` de `CapabilitiesResponse`. */
export const SUBSCRIPTION_STATUSES = ['ACTIVE', 'PROVISIONING', 'NOT_APPLICABLE'] as const;
export type SubscriptionStatusDto = (typeof SUBSCRIPTION_STATUSES)[number];

/**
 * Esquema `CapabilitiesResponse` de `GET /v1/me/capabilities`
 * (`get_capabilities_v1_me_capabilities_get`, contrato bff-web 0.8.0, HU003 y
 * ADR-024). `permissions` son los permisos estables del actor en el canal web;
 * `capabilities`, las de la suscripción activa del deportista.
 */
export interface CapabilitiesResponseDto {
  readonly actor_type: ActorTypeDto;
  readonly subscription_status: SubscriptionStatusDto;
  readonly plan_code: string | null;
  readonly plan_version: number | null;
  readonly catalog_version: string | null;
  readonly authorization_policy_version: string;
  readonly permissions: readonly string[];
  readonly capabilities: readonly string[];
  readonly evaluated_at: string;
}

/** Códigos de error que el contrato declara para `GET /v1/me/capabilities`. */
export const GET_CAPABILITIES_ERROR_CODES = {
  invalidAccessToken: 'invalid_access_token',
  unsupportedActorType: 'unsupported_actor_type',
  upstreamUnavailable: 'upstream_unavailable',
} as const;

/** Cliente del BFF web para la vista de identidad, permisos y capacidades. */
@Injectable({ providedIn: 'root' })
export class BffWebCapabilitiesApi {
  private readonly http = inject(HttpClient);
  private readonly bffWebUrl = inject(BffWebUrl);

  /** El usuario sale del access token: el cliente no puede consultar a otro. */
  getCapabilities(accessToken: string): Observable<CapabilitiesResponseDto> {
    return this.http.get<CapabilitiesResponseDto>(this.bffWebUrl.resolve('v1/me/capabilities'), {
      headers: new HttpHeaders({ Authorization: `Bearer ${accessToken}` }),
    });
  }
}
