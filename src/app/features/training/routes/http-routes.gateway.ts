import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { toApiError } from '../../../core/api/api-error';
import { readErrorResponse } from '../../../core/api/bff-web/contract';
import {
  BffWebRoutesApi,
  PUBLISH_ROUTE_ERROR_CODES,
  RETIRE_ROUTE_ERROR_CODES,
  ROUTE_IDEMPOTENT_REPLAYED_HEADER,
  ROUTE_LIMITS,
} from '../../../core/api/bff-web/routes.api';
import { SessionStore } from '../../../core/session/session.store';
import { RoutesGateway } from './routes.gateway';
import {
  PublishOutcome,
  RetireOutcome,
  RouteDraft,
  RoutesPage,
  toOrganizerRoute,
  toPublishRouteRequest,
} from './routes.model';

const INVALID_ACCESS_TOKEN = PUBLISH_ROUTE_ERROR_CODES.invalidAccessToken;
/** Fallos que se reintentan automáticamente: red, `502`, `503` y `504`. */
const TRANSIENT_STATUSES: readonly number[] = [0, 502, 503, 504];

/**
 * Esperas antes de cada reintento automático de publicar: hasta tres, progresivas.
 * Configurable para las pruebas.
 */
export const PUBLISH_ROUTE_RETRY_DELAYS_MS = new InjectionToken<readonly number[]>(
  'PUBLISH_ROUTE_RETRY_DELAYS_MS',
  { factory: () => [1_000, 2_000, 4_000] },
);

/**
 * Implementación de HU026 sobre `POST /v1/routes`, `POST /v1/routes/{route_id}/retire`
 * y `GET /v1/me/routes` (contrato bff-web 0.23.0). El organizador sale del token.
 */
@Injectable()
export class HttpRoutesGateway extends RoutesGateway {
  private readonly api = inject(BffWebRoutesApi);
  private readonly session = inject(SessionStore);
  private readonly retryDelays = inject(PUBLISH_ROUTE_RETRY_DELAYS_MS);

  async loadRoutes(cursor: string | null): Promise<RoutesPage> {
    const token = this.tokenOrEnd();
    try {
      const page = await firstValueFrom(
        this.api.getMyRoutes(token, { limit: ROUTE_LIMITS.listDefault, cursor }),
      );
      return { routes: page.items.map(toOrganizerRoute), nextCursor: page.next_cursor };
    } catch (error) {
      this.endSessionIfTokenRejected(error);
      throw error;
    }
  }

  async publish(
    draft: RouteDraft,
    idempotencyKey: string,
    onRetry?: (attempt: number) => void,
  ): Promise<PublishOutcome> {
    const body = toPublishRouteRequest(draft);
    for (let attempt = 0; ; attempt++) {
      const token = this.session.accessToken();
      if (token === null) {
        this.session.end('expired');
        return { kind: 'failed', error: unauthenticated() };
      }
      try {
        const response = await firstValueFrom(this.api.publishRoute(token, body, idempotencyKey));
        if (response.body === null) {
          // Una respuesta sin cuerpo no confirma la publicación: no se presenta como éxito.
          return { kind: 'failed', error: toApiError(null) };
        }
        return {
          kind: 'published',
          route: toOrganizerRoute(response.body),
          replayed: response.headers.get(ROUTE_IDEMPOTENT_REPLAYED_HEADER) === 'true',
        };
      } catch (error) {
        const transient =
          error instanceof HttpErrorResponse && TRANSIENT_STATUSES.includes(error.status);
        if (transient && attempt < this.retryDelays.length) {
          // Misma clave: si el intento anterior sí publicó, el BFF devuelve la misma ruta.
          onRetry?.(attempt + 1);
          await delay(this.retryDelays[attempt]);
          continue;
        }
        this.endSessionIfTokenRejected(error);
        const errorBody =
          error instanceof HttpErrorResponse ? readErrorResponse(error.error) : null;
        if (
          error instanceof HttpErrorResponse &&
          error.status === 422 &&
          errorBody?.code === PUBLISH_ROUTE_ERROR_CODES.validationError
        ) {
          return {
            kind: 'invalid',
            violations: (errorBody.details ?? []).map((detail) => ({
              field: (detail.field ?? '').replace(/^body\.?/, ''),
              issue: detail.issue,
            })),
          };
        }
        return { kind: 'failed', error: toApiError(error) };
      }
    }
  }

  async retire(routeId: string, expectedVersion: number): Promise<RetireOutcome> {
    const token = this.session.accessToken();
    if (token === null) {
      this.session.end('expired');
      return { kind: 'failed', error: unauthenticated() };
    }
    try {
      const route = await firstValueFrom(
        this.api.retireRoute(token, routeId, { expected_version: expectedVersion }),
      );
      return { kind: 'retired', route: toOrganizerRoute(route) };
    } catch (error) {
      this.endSessionIfTokenRejected(error);
      const body = error instanceof HttpErrorResponse ? readErrorResponse(error.error) : null;
      if (body?.code === RETIRE_ROUTE_ERROR_CODES.versionConflict) {
        const detail = (body.details ?? []).find((item) => item.field === 'expected_version');
        return {
          kind: 'conflict',
          currentVersion:
            detail !== undefined && /^\d+$/.test(detail.issue) ? Number(detail.issue) : null,
        };
      }
      // Incluye `route_not_found`, `permission_required` y transitorios: nunca es éxito.
      return { kind: 'failed', error: toApiError(error) };
    }
  }

  /** Access token vigente o, si venció, termina la sesión y rechaza como `401`. */
  private tokenOrEnd(): string {
    const token = this.session.accessToken();
    if (token === null) {
      this.session.end('expired');
      throw new HttpErrorResponse({ status: 401 });
    }
    return token;
  }

  private endSessionIfTokenRejected(error: unknown): void {
    if (
      error instanceof HttpErrorResponse &&
      error.status === 401 &&
      readErrorResponse(error.error)?.code === INVALID_ACCESS_TOKEN
    ) {
      this.session.end('expired');
    }
  }
}

function unauthenticated() {
  return { kind: 'unauthenticated' as const, status: null, code: null, correlationId: null };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
