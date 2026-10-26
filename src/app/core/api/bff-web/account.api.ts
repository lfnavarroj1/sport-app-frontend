import { HttpClient, HttpHeaders, HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { BffWebUrl } from '../bff-web-url';
import { ActorTypeDto } from './contract';

/**
 * Transporte de la cuenta del usuario (HU002, ADR-035) del contrato bff-web
 * 0.28.0 (ver `contract.ts`): `GET /v1/me/account` (`get_account_v1_me_account_get`)
 * y `PUT /v1/me/account` (`put_account_v1_me_account_put`). Aplica a los tres
 * actores; la identidad sale del token y el cuerpo solo lleva `expected_version`,
 * `full_name` y `email`. Estos tipos son del transporte: la interfaz los
 * transforma antes de usarlos.
 */

/** Enumeración `status` de la cuenta. */
export const ACCOUNT_STATUSES = ['active', 'disabled'] as const;
export type AccountStatusDto = (typeof ACCOUNT_STATUSES)[number];

/** Esquema `AccountUpdateRequest`: sin propiedades adicionales. */
export interface AccountUpdateRequestDto {
  /** Versión vigente de la cuenta (obligatoria). */
  readonly expected_version: number;
  readonly full_name: string;
  readonly email: string;
}

/** Esquema `AccountResponse`: la cuenta confirmada después del `COMMIT`. */
export interface AccountResponseDto {
  readonly user_id: string;
  readonly full_name: string;
  readonly email: string;
  readonly actor_type: ActorTypeDto;
  readonly status: AccountStatusDto;
  readonly version: number;
  /** UTC con sufijo `Z`. */
  readonly updated_at: string;
}

/** Esquema `AccountReadResponse`: la cuenta proyectada en `user_directory` (eventual). */
export interface AccountReadResponseDto {
  readonly user_id: string;
  readonly full_name: string;
  readonly email: string;
  readonly actor_type: ActorTypeDto;
  readonly status: AccountStatusDto;
  readonly version: number;
  /** Última proyección aplicada, en UTC (`Z`). */
  readonly projected_at: string;
}

/** Límites de `AccountUpdateRequest` en el contrato (ADR-035). */
export const ACCOUNT_LIMITS = {
  fullNameMin: 1,
  fullNameMax: 120,
  emailMax: 254,
} as const;

/** Códigos de error que el contrato declara para las dos operaciones. */
export const ACCOUNT_ERROR_CODES = {
  invalidAccessToken: 'invalid_access_token',
  userNotFound: 'user_not_found',
  versionConflict: 'version_conflict',
  emailAlreadyRegistered: 'email_already_registered',
  idempotencyKeyReused: 'idempotency_key_reused',
  validationError: 'validation_error',
  upstreamUnavailable: 'upstream_unavailable',
  upstreamTimeout: 'upstream_timeout',
} as const;

/** Motivos de `details[].issue` de `validation_error` que declara el `422` del `PUT`. */
export const ACCOUNT_ISSUES = [
  'required',
  'invalid_length',
  'unknown_value',
  'out_of_range',
  'field_not_allowed',
] as const;

/**
 * Campo de `details` en `409 version_conflict`: su `issue` es la versión vigente
 * como texto.
 */
export const ACCOUNT_VERSION_CONFLICT_FIELD = 'expected_version';

/** Cabecera de respuesta que marca el resultado de un reintento idempotente. */
export const ACCOUNT_IDEMPOTENT_REPLAYED_HEADER = 'Idempotent-Replayed';

/** Cliente del BFF web para la cuenta del usuario de la sesión (HU002). */
@Injectable({ providedIn: 'root' })
export class BffWebAccountApi {
  private readonly http = inject(HttpClient);
  private readonly bffWebUrl = inject(BffWebUrl);

  /** Cuenta proyectada del usuario de la sesión. */
  getAccount(accessToken: string): Observable<AccountReadResponseDto> {
    return this.http.get<AccountReadResponseDto>(this.bffWebUrl.resolve('v1/me/account'), {
      headers: new HttpHeaders({ Authorization: `Bearer ${accessToken}` }),
    });
  }

  /**
   * Edita el nombre y el correo. Se devuelve la respuesta completa para leer
   * `Idempotent-Replayed`.
   *
   * @param idempotencyKey UUID (`Idempotency-Key`); igual en todos los reintentos
   * del mismo intento lógico.
   */
  putAccount(
    accessToken: string,
    body: AccountUpdateRequestDto,
    idempotencyKey: string,
  ): Observable<HttpResponse<AccountResponseDto>> {
    return this.http.put<AccountResponseDto>(this.bffWebUrl.resolve('v1/me/account'), body, {
      headers: new HttpHeaders({
        Authorization: `Bearer ${accessToken}`,
        'Idempotency-Key': idempotencyKey,
      }),
      observe: 'response',
    });
  }
}
