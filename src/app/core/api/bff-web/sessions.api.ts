import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { BffWebUrl } from '../bff-web-url';
import { ActorTypeDto } from './contract';

/**
 * Transporte de `POST /v1/sessions` (operationId `create_session_v1_sessions_post`)
 * del contrato bff-web 0.3.0 (HU003).
 */
export interface LoginRequestDto {
  readonly email: string;
  readonly password: string;
}

export interface SessionUserDto {
  readonly user_id: string;
  readonly full_name: string;
  readonly email: string;
  readonly actor_type: ActorTypeDto;
}

/**
 * Esquema `SessionResponse`. En 0.3.0 incluye `refresh_token` en el cuerpo; por
 * decisión del responsable (2026-10-10) la web no lo lee ni lo conserva: el
 * refresh token debe viajar en una cookie HttpOnly que fija el BFF (contrato
 * pendiente).
 */
export interface SessionResponseDto {
  readonly token_type: 'Bearer';
  readonly access_token: string;
  readonly expires_in: number;
  readonly refresh_token?: string;
  readonly refresh_expires_in: number;
  readonly user: SessionUserDto;
}

/** Códigos de error que el contrato declara para `POST /v1/sessions`. */
export const CREATE_SESSION_ERROR_CODES = {
  invalidCredentials: 'invalid_credentials',
  validationError: 'validation_error',
  tooManyAttempts: 'too_many_attempts',
  upstreamUnavailable: 'upstream_unavailable',
  upstreamTimeout: 'upstream_timeout',
} as const;

/** Cliente del BFF web para las operaciones de sesión. */
@Injectable({ providedIn: 'root' })
export class BffWebSessionsApi {
  private readonly http = inject(HttpClient);
  private readonly bffWebUrl = inject(BffWebUrl);

  createSession(body: LoginRequestDto): Observable<SessionResponseDto> {
    return this.http.post<SessionResponseDto>(this.bffWebUrl.resolve('v1/sessions'), body);
  }
}
