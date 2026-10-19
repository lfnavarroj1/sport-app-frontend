import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { toApiError } from '../../../core/api/api-error';
import { readErrorResponse } from '../../../core/api/bff-web/contract';
import {
  BffWebSessionsApi,
  REVOKE_SESSION_ERROR_CODES,
} from '../../../core/api/bff-web/sessions.api';
import { LogoutGateway, LogoutOutcome } from './logout.gateway';

/** Códigos con los que el BFF borra la cookie aunque no confirme la revocación. */
const COOKIE_CLEARED_CODES: readonly string[] = [
  REVOKE_SESSION_ERROR_CODES.upstreamUnavailable,
  REVOKE_SESSION_ERROR_CODES.upstreamTimeout,
];

/**
 * Implementación de HU004 sobre `POST /v1/sessions/revoke` del BFF web (contrato
 * 0.16.0, sin cambios desde 0.7.0). No envía cuerpo ni access token: la
 * credencial es la cookie `HttpOnly`, que la aplicación no lee ni registra.
 */
@Injectable()
export class HttpLogoutGateway extends LogoutGateway {
  private readonly api = inject(BffWebSessionsApi);

  async logout(): Promise<LogoutOutcome> {
    try {
      await firstValueFrom(this.api.revokeSession(), { defaultValue: undefined });
      return { kind: 'revoked' };
    } catch (error) {
      if (
        error instanceof HttpErrorResponse &&
        (error.status === 503 || error.status === 504) &&
        COOKIE_CLEARED_CODES.includes(readErrorResponse(error.error)?.code ?? '')
      ) {
        return { kind: 'unconfirmed' };
      }
      // Sin conexión la solicitud no llegó y la cookie sigue viva; con
      // `origin_not_allowed` el BFF no la toca. Nada de eso es un cierre.
      return { kind: 'failed', error: toApiError(error) };
    }
  }
}
