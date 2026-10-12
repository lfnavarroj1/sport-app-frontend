import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { BffWebSessionsApi } from '../api/bff-web/sessions.api';
import { sessionFromResponse } from './session-response';
import { RefreshOutcome, SessionRefresher } from './session-refresher';

/**
 * Nombre del bloqueo (Web Locks API) que serializa las renovaciones entre pestañas.
 * La cookie es compartida y rota en cada uso: dos renovaciones simultáneas con la
 * misma cookie harían que el backend detecte una reutilización y revoque la sesión.
 */
const REFRESH_LOCK = 'sportapp-session-refresh';

/** Implementación de la renovación sobre `POST /v1/sessions/refresh` (bff-web 0.6.0). */
@Injectable()
export class HttpSessionRefresher extends SessionRefresher {
  private readonly api = inject(BffWebSessionsApi);

  async refresh(): Promise<RefreshOutcome> {
    const locks = globalThis.navigator?.locks;
    return locks ? await locks.request(REFRESH_LOCK, () => this.request()) : this.request();
  }

  private async request(): Promise<RefreshOutcome> {
    try {
      const response = await firstValueFrom(this.api.refreshSession());
      const session = sessionFromResponse(response, Date.now());
      return session ? { kind: 'renewed', session } : { kind: 'rejected' };
    } catch (error) {
      return outcomeFromError(error);
    }
  }
}

/**
 * `invalid_refresh_token` (401), `origin_not_allowed` (403) y cualquier otro 4xx
 * no tienen arreglo reintentando. Sin conexión, `upstream_unavailable` (503),
 * `upstream_timeout` (504) u otro 5xx sí: el BFF conserva la cookie en esos casos.
 */
function outcomeFromError(error: unknown): RefreshOutcome {
  if (error instanceof HttpErrorResponse && error.status > 0 && error.status < 500) {
    return { kind: 'rejected' };
  }
  return { kind: 'unavailable' };
}
