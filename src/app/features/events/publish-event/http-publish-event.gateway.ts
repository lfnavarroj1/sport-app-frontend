import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { toApiError } from '../../../core/api/api-error';
import { readErrorResponse } from '../../../core/api/bff-web/contract';
import {
  BffWebEventsApi,
  EVENT_IDEMPOTENT_REPLAYED_HEADER,
  MY_EVENTS_LIMIT,
  PUBLISH_EVENT_ERROR_CODES,
} from '../../../core/api/bff-web/events.api';
import { SessionStore } from '../../../core/session/session.store';
import { PublishEventGateway } from './publish-event.gateway';
import {
  EventDetail,
  EventStatus,
  OrganizerEventsPage,
  PublishOutcome,
  toEventDetail,
  toOrganizerEvent,
} from './publish-event.model';

const INVALID_ACCESS_TOKEN = PUBLISH_EVENT_ERROR_CODES.invalidAccessToken;
const VALIDATION_ERROR = PUBLISH_EVENT_ERROR_CODES.validationError;

/** Estados transitorios que se reintentan automáticamente (ADR-033, decisión 8). */
const TRANSIENT_STATUSES: readonly number[] = [0, 502, 503, 504];

/**
 * Esperas antes de cada reintento automático de publicar: hasta tres,
 * progresivas (ADR-033, decisión 8). Configurable para las pruebas.
 */
export const PUBLISH_EVENT_RETRY_DELAYS_MS = new InjectionToken<readonly number[]>(
  'PUBLISH_EVENT_RETRY_DELAYS_MS',
  { factory: () => [1_000, 2_000, 4_000] },
);

/**
 * Implementación de HU024 sobre `GET /v1/me/events`, `GET /v1/events/{event_id}`
 * y `POST /v1/events/{event_id}/publish` (contrato bff-web 0.16.0). El
 * organizador sale del token: la web nunca envía `organizer_id`.
 */
@Injectable()
export class HttpPublishEventGateway extends PublishEventGateway {
  private readonly api = inject(BffWebEventsApi);
  private readonly session = inject(SessionStore);
  private readonly retryDelays = inject(PUBLISH_EVENT_RETRY_DELAYS_MS);

  async loadEvents(status: EventStatus, cursor: string | null): Promise<OrganizerEventsPage> {
    const token = this.tokenOrEnd();
    try {
      const response = await firstValueFrom(
        this.api.getMyEvents(token, { status, limit: MY_EVENTS_LIMIT.default, cursor }),
      );
      return {
        events: response.items.map(toOrganizerEvent),
        nextCursor: response.next_cursor,
      };
    } catch (error) {
      this.endSessionIfTokenRejected(error);
      throw error;
    }
  }

  async loadEvent(eventId: string): Promise<EventDetail> {
    const token = this.tokenOrEnd();
    try {
      return toEventDetail(await firstValueFrom(this.api.getEvent(token, eventId)));
    } catch (error) {
      this.endSessionIfTokenRejected(error);
      throw error;
    }
  }

  async publish(
    eventId: string,
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
          this.api.publishEvent(token, eventId, idempotencyKey),
        );
        if (response.body === null) {
          // Un 200 sin cuerpo no confirma la publicación: no se presenta como éxito.
          return { kind: 'failed', error: toApiError(null) };
        }
        return {
          kind: 'published',
          event: toOrganizerEvent(response.body),
          replayed: response.headers.get(EVENT_IDEMPOTENT_REPLAYED_HEADER) === 'true',
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
            field: detail.field ?? '',
            issue: detail.issue,
          })),
        };
      }
    }
    // Incluye `permission_required`, `event_not_found`, `idempotency_key_reused`,
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
