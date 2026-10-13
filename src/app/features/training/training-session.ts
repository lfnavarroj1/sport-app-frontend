import { HttpErrorResponse } from '@angular/common/http';

import { ApiError } from '../../core/api/api-error';
import { readErrorResponse } from '../../core/api/bff-web/contract';
import { SessionStore } from '../../core/session/session.store';

const INVALID_ACCESS_TOKEN = 'invalid_access_token';

/** Error que representa una sesión ya terminada al intentar la operación. */
export const SESSION_EXPIRED: ApiError = {
  kind: 'unauthenticated',
  status: null,
  code: null,
  correlationId: null,
};

/**
 * Access token vigente para las operaciones de HU010 o, si ya venció, termina la
 * sesión como vencida (el área del actor lleva al acceso) y devuelve `null`.
 */
export function accessTokenOrEnd(session: SessionStore): string | null {
  const token = session.accessToken();
  if (token === null) {
    session.end('expired');
  }
  return token;
}

/**
 * Si el BFF rechazó el access token (`401 invalid_access_token`), la sesión
 * termina como vencida, igual que con `GET /v1/me/capabilities`.
 */
export function endSessionIfTokenRejected(session: SessionStore, error: unknown): void {
  if (
    error instanceof HttpErrorResponse &&
    error.status === 401 &&
    readErrorResponse(error.error)?.code === INVALID_ACCESS_TOKEN
  ) {
    session.end('expired');
  }
}
