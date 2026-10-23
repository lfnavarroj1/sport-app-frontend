import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { toApiError } from '../../../core/api/api-error';
import { readErrorResponse } from '../../../core/api/bff-web/contract';
import {
  BffWebServicesApi,
  MY_SERVICES_LIMIT,
  PUBLISH_SERVICE_ERROR_CODES,
  SERVICE_IDEMPOTENT_REPLAYED_HEADER,
} from '../../../core/api/bff-web/services.api';
import { SessionStore } from '../../../core/session/session.store';
import { PublishServiceGateway } from './publish-service.gateway';
import {
  OwnService,
  OwnServicesPage,
  PublishOutcome,
  ServiceStatus,
  toOwnService,
  toPublishedService,
} from './publish-service.model';

const INVALID_ACCESS_TOKEN = PUBLISH_SERVICE_ERROR_CODES.invalidAccessToken;
const VALIDATION_ERROR = PUBLISH_SERVICE_ERROR_CODES.validationError;

/** Estados transitorios que se reintentan automáticamente (ADR-027, publicación, decisión 8). */
const TRANSIENT_STATUSES: readonly number[] = [0, 502, 503, 504];

/**
 * Esperas antes de cada reintento automático de publicar: hasta tres,
 * progresivas (ADR-027, publicación, decisión 8). Configurable para las pruebas.
 */
export const PUBLISH_SERVICE_RETRY_DELAYS_MS = new InjectionToken<readonly number[]>(
  'PUBLISH_SERVICE_RETRY_DELAYS_MS',
  { factory: () => [1_000, 2_000, 4_000] },
);

/**
 * Implementación de HU019 sobre `GET /v1/me/services`,
 * `GET /v1/me/services/{service_id}` y `POST /v1/services/{service_id}/publish`
 * (contrato bff-web 0.16.0). El profesional sale del token: la web nunca envía
 * `provider_id`.
 */
@Injectable()
export class HttpPublishServiceGateway extends PublishServiceGateway {
  private readonly api = inject(BffWebServicesApi);
  private readonly session = inject(SessionStore);
  private readonly retryDelays = inject(PUBLISH_SERVICE_RETRY_DELAYS_MS);

  async loadServices(status: ServiceStatus, cursor: string | null): Promise<OwnServicesPage> {
    const token = this.tokenOrEnd();
    try {
      const response = await firstValueFrom(
        this.api.getMyServices(token, { status, limit: MY_SERVICES_LIMIT.default, cursor }),
      );
      return {
        services: response.items.map(toOwnService),
        nextCursor: response.next_cursor,
      };
    } catch (error) {
      this.endSessionIfTokenRejected(error);
      throw error;
    }
  }

  async loadService(serviceId: string): Promise<OwnService> {
    const token = this.tokenOrEnd();
    try {
      return toOwnService(await firstValueFrom(this.api.getMyService(token, serviceId)));
    } catch (error) {
      this.endSessionIfTokenRejected(error);
      throw error;
    }
  }

  async publish(
    serviceId: string,
    idempotencyKey: string,
    onRetry?: (attempt: number) => void,
  ): Promise<PublishOutcome> {
    for (let attempt = 0; ; attempt++) {
      const token = this.session.accessToken();
      if (token === null) {
        this.session.end('expired');
        return {
          kind: 'failed',
          error: { kind: 'unauthenticated', status: null, code: null, correlationId: null },
        };
      }
      try {
        const response = await firstValueFrom(
          this.api.publishService(token, serviceId, idempotencyKey),
        );
        if (response.body === null) {
          // Un 200 sin cuerpo no confirma la publicación: no se presenta como éxito.
          return { kind: 'failed', error: toApiError(null) };
        }
        return {
          kind: 'published',
          service: toPublishedService(response.body),
          replayed: response.headers.get(SERVICE_IDEMPOTENT_REPLAYED_HEADER) === 'true',
        };
      } catch (error) {
        const transient =
          error instanceof HttpErrorResponse && TRANSIENT_STATUSES.includes(error.status);
        if (transient && attempt < this.retryDelays.length) {
          // Misma clave: si el intento anterior sí publicó, el BFF devuelve el mismo resultado.
          onRetry?.(attempt + 1);
          await delay(this.retryDelays[attempt]);
          continue;
        }
        return this.outcomeFromError(error);
      }
    }
  }

  private outcomeFromError(error: unknown): PublishOutcome {
    if (error instanceof HttpErrorResponse) {
      this.endSessionIfTokenRejected(error);
      const body = readErrorResponse(error.error);
      if (error.status === 422 && body?.code === VALIDATION_ERROR) {
        return {
          kind: 'invalid',
          violations: (body.details ?? []).map((detail) => ({
            field: (detail.field ?? '').replace(/^body\.?/, ''),
            issue: detail.issue,
          })),
        };
      }
    }
    // Incluye `permission_required`, `service_not_found`, `idempotency_key_reused`,
    // transitorios agotados y cualquier respuesta no prevista: nunca es éxito.
    return { kind: 'failed', error: toApiError(error) };
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
