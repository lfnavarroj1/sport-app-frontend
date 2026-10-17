import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { BffWebUrl } from '../bff-web-url';
import { ActorTypeDto } from './contract';

/**
 * Transporte de las operaciones de sesión del contrato bff-web 0.13.0:
 * `POST /v1/sessions` (`create_session_v1_sessions_post`) y
 * `POST /v1/sessions/refresh` (`refresh_v1_sessions_refresh_post`) de HU003, y
 * `POST /v1/sessions/revoke` (`revoke_v1_sessions_revoke_post`) de HU004.
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
 * Esquema `WebSessionResponse`. No trae `refresh_token`: el BFF lo fija en la
 * cookie `HttpOnly` `__Secure-sportapp_refresh`, que la aplicación no puede leer.
 */
export interface WebSessionResponseDto {
  readonly token_type: 'Bearer';
  readonly access_token: string;
  readonly expires_in: number;
  readonly refresh_expires_in: number;
  readonly user: SessionUserDto;
}

/** Códigos de error que el contrato declara para `POST /v1/sessions`. */
export const CREATE_SESSION_ERROR_CODES = {
  invalidCredentials: 'invalid_credentials',
  originNotAllowed: 'origin_not_allowed',
  validationError: 'validation_error',
  tooManyAttempts: 'too_many_attempts',
  upstreamUnavailable: 'upstream_unavailable',
  upstreamTimeout: 'upstream_timeout',
} as const;

/** Códigos de error que el contrato declara para `POST /v1/sessions/refresh`. */
export const REFRESH_SESSION_ERROR_CODES = {
  invalidRefreshToken: 'invalid_refresh_token',
  originNotAllowed: 'origin_not_allowed',
  upstreamUnavailable: 'upstream_unavailable',
  upstreamTimeout: 'upstream_timeout',
} as const;

/** Códigos de error que el contrato declara para `POST /v1/sessions/revoke` (HU004). */
export const REVOKE_SESSION_ERROR_CODES = {
  originNotAllowed: 'origin_not_allowed',
  upstreamUnavailable: 'upstream_unavailable',
  upstreamTimeout: 'upstream_timeout',
} as const;

/**
 * Cliente del BFF web para las operaciones de sesión. Todas van con credenciales:
 * así el navegador guarda la cookie del refresh token al iniciar sesión y la
 * envía al renovar y al cerrar sesión.
 */
@Injectable({ providedIn: 'root' })
export class BffWebSessionsApi {
  private readonly http = inject(HttpClient);
  private readonly bffWebUrl = inject(BffWebUrl);

  createSession(body: LoginRequestDto): Observable<WebSessionResponseDto> {
    return this.http.post<WebSessionResponseDto>(this.bffWebUrl.resolve('v1/sessions'), body, {
      withCredentials: true,
    });
  }

  /** Sin cuerpo: el BFF toma el refresh token de la cookie y la rota. */
  refreshSession(): Observable<WebSessionResponseDto> {
    return this.http.post<WebSessionResponseDto>(
      this.bffWebUrl.resolve('v1/sessions/refresh'),
      null,
      { withCredentials: true },
    );
  }

  /**
   * Cierra la sesión (HU004). Sin cuerpo ni access token: el BFF revoca la sesión
   * de la cookie y la borra. Responde `204` aunque no haya cookie o la sesión ya
   * esté cerrada; con `503`/`504` también borra la cookie, pero la revocación
   * remota no se confirmó.
   */
  revokeSession(): Observable<void> {
    return this.http.post<void>(this.bffWebUrl.resolve('v1/sessions/revoke'), null, {
      withCredentials: true,
    });
  }
}
