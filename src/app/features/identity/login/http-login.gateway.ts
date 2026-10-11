import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { toApiError } from '../../../core/api/api-error';
import { readErrorResponse } from '../../../core/api/bff-web/contract';
import {
  BffWebSessionsApi,
  CREATE_SESSION_ERROR_CODES,
  SessionResponseDto,
} from '../../../core/api/bff-web/sessions.api';
import { Session } from '../../../core/session/session.store';
import { LoginGateway } from './login.gateway';
import { LoginCredentials, LoginOutcome } from './login.model';

/** Implementación de HU003 sobre `POST /v1/sessions` del BFF web (contrato 0.3.0). */
@Injectable()
export class HttpLoginGateway extends LoginGateway {
  private readonly api = inject(BffWebSessionsApi);

  async login(credentials: LoginCredentials): Promise<LoginOutcome> {
    try {
      const response = await firstValueFrom(
        this.api.createSession({ email: credentials.email, password: credentials.password }),
      );
      return { kind: 'authenticated', session: toSession(response, Date.now()) };
    } catch (error) {
      return outcomeFromError(error);
    }
  }
}

/**
 * Conserva solo identidad, access token y su vencimiento. `refresh_token` se
 * descarta a propósito: no debe quedar en memoria accesible a scripts.
 */
function toSession(response: SessionResponseDto, receivedAt: number): Session {
  return {
    user: {
      id: response.user.user_id,
      fullName: response.user.full_name,
      email: response.user.email,
      actorType: response.user.actor_type,
    },
    accessToken: response.access_token,
    expiresAt: receivedAt + response.expires_in * 1000,
  };
}

function outcomeFromError(error: unknown): LoginOutcome {
  if (error instanceof HttpErrorResponse) {
    const code = readErrorResponse(error.error)?.code;
    if (error.status === 401 && code === CREATE_SESSION_ERROR_CODES.invalidCredentials) {
      return { kind: 'invalid_credentials' };
    }
    if (error.status === 429 && code === CREATE_SESSION_ERROR_CODES.tooManyAttempts) {
      return { kind: 'too_many_attempts', retryAfterSeconds: retryAfter(error) };
    }
  }
  // Incluye `validation_error`, `upstream_unavailable`, `upstream_timeout`, sin
  // conexión y cualquier respuesta no prevista: nunca se interpreta como sesión.
  return { kind: 'failed', error: toApiError(error) };
}

/** `Retry-After` en segundos (el BFF lo expone por CORS); `null` si falta o no es válido. */
function retryAfter(error: HttpErrorResponse): number | null {
  const value = Number(error.headers.get('Retry-After'));
  return Number.isInteger(value) && value > 0 ? value : null;
}
