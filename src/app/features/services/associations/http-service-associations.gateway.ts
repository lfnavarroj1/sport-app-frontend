import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { toApiError } from '../../../core/api/api-error';
import { readErrorResponse } from '../../../core/api/bff-web/contract';
import {
  ASSOCIATE_SERVICE_ERROR_CODES,
  ASSOCIATION_IDEMPOTENT_REPLAYED_HEADER,
  BffWebServiceAssociationsApi,
  SERVICE_ASSOCIATIONS_LIMITS,
} from '../../../core/api/bff-web/service-associations.api';
import { SessionStore } from '../../../core/session/session.store';
import { ServiceAssociationsGateway } from './service-associations.gateway';
import {
  AssociateOutcome,
  AssociationsFilter,
  AssociationsPage,
  DissociateOutcome,
  toServiceAssociation,
} from './service-associations.model';

const INVALID_ACCESS_TOKEN = ASSOCIATE_SERVICE_ERROR_CODES.invalidAccessToken;
/** Fallos que se reintentan automáticamente: red, `502`, `503` y `504`. */
const TRANSIENT_STATUSES: readonly number[] = [0, 502, 503, 504];

/**
 * Esperas antes de cada reintento automático de asociar: hasta tres, progresivas.
 * Configurable para las pruebas.
 */
export const ASSOCIATE_SERVICE_RETRY_DELAYS_MS = new InjectionToken<readonly number[]>(
  'ASSOCIATE_SERVICE_RETRY_DELAYS_MS',
  { factory: () => [1_000, 2_000, 4_000] },
);

/**
 * Implementación de HU017 sobre `POST /v1/me/service-associations`, `DELETE
 * /v1/me/service-associations/{association_id}` y `GET /v1/me/service-associations`
 * (contrato bff-web 0.25.0). El deportista sale del token; la capacidad la
 * verifican el BFF y el servicio.
 */
@Injectable()
export class HttpServiceAssociationsGateway extends ServiceAssociationsGateway {
  private readonly api = inject(BffWebServiceAssociationsApi);
  private readonly session = inject(SessionStore);
  private readonly retryDelays = inject(ASSOCIATE_SERVICE_RETRY_DELAYS_MS);

  async loadPage(filter: AssociationsFilter, cursor: string | null): Promise<AssociationsPage> {
    const token = this.session.accessToken();
    if (token === null) {
      // Sin access token vigente la sesión termina como vencida y no se llama al BFF.
      this.session.end('expired');
      throw new HttpErrorResponse({ status: 401 });
    }
    try {
      const page = await firstValueFrom(
        this.api.listMine(token, {
          status: filter,
          limit: SERVICE_ASSOCIATIONS_LIMITS.listDefault,
          cursor,
        }),
      );
      return {
        associations: page.items.map(toServiceAssociation),
        nextCursor: page.next_cursor,
      };
    } catch (error) {
      this.endSessionIfTokenRejected(error);
      throw error;
    }
  }

  async associate(
    serviceId: string,
    idempotencyKey: string,
    onRetry?: (attempt: number) => void,
  ): Promise<AssociateOutcome> {
    for (let attempt = 0; ; attempt++) {
      const token = this.session.accessToken();
      if (token === null) {
        this.session.end('expired');
        return { kind: 'failed', error: unauthenticated() };
      }
      try {
        const response = await firstValueFrom(
          this.api.associate(token, { service_id: serviceId }, idempotencyKey),
        );
        if (response.body === null) {
          // Una respuesta sin cuerpo no confirma la asociación: no se presenta como éxito.
          return { kind: 'failed', error: toApiError(null) };
        }
        return {
          kind: 'associated',
          association: toServiceAssociation(response.body),
          replayed: response.headers.get(ASSOCIATION_IDEMPOTENT_REPLAYED_HEADER) === 'true',
        };
      } catch (error) {
        const transient =
          error instanceof HttpErrorResponse && TRANSIENT_STATUSES.includes(error.status);
        if (transient && attempt < this.retryDelays.length) {
          // Misma clave: si el intento anterior sí asoció, el BFF devuelve la misma asociación.
          onRetry?.(attempt + 1);
          await delay(this.retryDelays[attempt]);
          continue;
        }
        this.endSessionIfTokenRejected(error);
        const body = error instanceof HttpErrorResponse ? readErrorResponse(error.error) : null;
        if (body?.code === ASSOCIATE_SERVICE_ERROR_CODES.associationExists) {
          const detail = (body.details ?? []).find((item) => item.field === 'association_id');
          return { kind: 'exists', associationId: detail?.issue ?? null };
        }
        // Incluye `service_not_found`, `capability_required` y los transitorios agotados.
        return { kind: 'failed', error: toApiError(error) };
      }
    }
  }

  async dissociate(associationId: string): Promise<DissociateOutcome> {
    const token = this.session.accessToken();
    if (token === null) {
      this.session.end('expired');
      return { kind: 'failed', error: unauthenticated() };
    }
    try {
      await firstValueFrom(this.api.dissociate(token, associationId));
      return { kind: 'dissociated' };
    } catch (error) {
      this.endSessionIfTokenRejected(error);
      // Incluye `association_not_found`, `capability_required` y transitorios: nunca es éxito.
      return { kind: 'failed', error: toApiError(error) };
    }
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
