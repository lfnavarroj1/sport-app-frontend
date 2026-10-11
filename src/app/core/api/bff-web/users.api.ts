import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { BffWebUrl } from '../bff-web-url';

/**
 * Transporte de la operación `POST /v1/users` (operationId `register_v1_users_post`)
 * del contrato bff-web 0.2.0, copiado sin cambios en `contracts/bff-web.openapi.json`.
 * Estos tipos son del transporte: la interfaz los transforma antes de usarlos.
 */
export const BFF_WEB_CONTRACT_VERSION = '0.2.0';

/** Enumeración `actor_type` de `RegisterUserRequest`. */
export const ACTOR_TYPES = ['athlete', 'organizer', 'service_provider'] as const;
export type ActorTypeDto = (typeof ACTOR_TYPES)[number];

export interface RegisterUserRequestDto {
  readonly full_name: string;
  readonly email: string;
  readonly password: string;
  readonly actor_type: ActorTypeDto;
  readonly accepted_policies_version: string;
}

export interface UserRegisteredResponseDto {
  readonly user_id: string;
  readonly full_name: string;
  readonly email: string;
  readonly actor_type: ActorTypeDto;
  readonly status: 'active';
  readonly aggregate_version: number;
  readonly created_at: string;
}

export interface ErrorDetailDto {
  readonly field?: string | null;
  readonly issue: string;
}

export interface ErrorResponseDto {
  readonly code: string;
  readonly message: string;
  readonly correlation_id: string | null;
  readonly details?: readonly ErrorDetailDto[];
}

/** Códigos de error que el contrato declara para `POST /v1/users`. */
export const REGISTER_USER_ERROR_CODES = {
  emailAlreadyRegistered: 'email_already_registered',
  idempotencyKeyReused: 'idempotency_key_reused',
  validationError: 'validation_error',
  policiesVersionMismatch: 'policies_version_mismatch',
  upstreamUnavailable: 'upstream_unavailable',
  upstreamTimeout: 'upstream_timeout',
} as const;

/** Cliente del BFF web para las operaciones de usuarios. */
@Injectable({ providedIn: 'root' })
export class BffWebUsersApi {
  private readonly http = inject(HttpClient);
  private readonly bffWebUrl = inject(BffWebUrl);

  /**
   * @param idempotencyKey UUID obligatorio (`Idempotency-Key`); igual en los
   * reintentos del mismo intento lógico.
   */
  registerUser(
    body: RegisterUserRequestDto,
    idempotencyKey: string,
  ): Observable<UserRegisteredResponseDto> {
    return this.http.post<UserRegisteredResponseDto>(this.bffWebUrl.resolve('v1/users'), body, {
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  }
}
