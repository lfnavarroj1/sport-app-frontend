import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { toApiError } from '../../../core/api/api-error';
import { readErrorResponse } from '../../../core/api/bff-web/contract';
import {
  BffWebEventsApi,
  CREATE_EVENT_ERROR_CODES,
  EVENT_IDEMPOTENT_REPLAYED_HEADER,
} from '../../../core/api/bff-web/events.api';
import { SessionStore } from '../../../core/session/session.store';
import { CreateEventGateway } from './create-event.gateway';
import {
  CreateEventOutcome,
  EventDraft,
  toCreateEventRequest,
  toCreatedEvent,
} from './create-event.model';

const INVALID_ACCESS_TOKEN = CREATE_EVENT_ERROR_CODES.invalidAccessToken;
const VALIDATION_ERROR = CREATE_EVENT_ERROR_CODES.validationError;

/** Estados transitorios que se reintentan automáticamente (ADR-028, decisión 10). */
const TRANSIENT_STATUSES: readonly number[] = [0, 502, 503, 504];

/**
 * Esperas antes de cada reintento automático: hasta tres, progresivas
 * (ADR-028, decisión 10). Configurable para las pruebas.
 */
export const CREATE_EVENT_RETRY_DELAYS_MS = new InjectionToken<readonly number[]>(
  'CREATE_EVENT_RETRY_DELAYS_MS',
  { factory: () => [1_000, 2_000, 4_000] },
);

/** Implementación de HU021 sobre `POST /v1/events` del BFF web (contrato 0.12.0). */
@Injectable()
export class HttpCreateEventGateway extends CreateEventGateway {
  private readonly api = inject(BffWebEventsApi);
  private readonly session = inject(SessionStore);
  private readonly retryDelays = inject(CREATE_EVENT_RETRY_DELAYS_MS);

  async createEvent(
    draft: EventDraft,
    idempotencyKey: string,
    onRetry?: (attempt: number) => void,
  ): Promise<CreateEventOutcome> {
    const body = toCreateEventRequest(draft);
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
        const response = await firstValueFrom(this.api.createEvent(token, body, idempotencyKey));
        if (response.body === null) {
          // Un 201 sin cuerpo no confirma ningún borrador: no se presenta como éxito.
          return { kind: 'failed', error: toApiError(null) };
        }
        return {
          kind: 'created',
          event: toCreatedEvent(response.body),
          replayed: response.headers.get(EVENT_IDEMPOTENT_REPLAYED_HEADER) === 'true',
        };
      } catch (error) {
        const transient =
          error instanceof HttpErrorResponse && TRANSIENT_STATUSES.includes(error.status);
        if (transient && attempt < this.retryDelays.length) {
          // Misma clave: si el primer intento sí se guardó, el BFF devuelve el mismo evento.
          onRetry?.(attempt + 1);
          await delay(this.retryDelays[attempt]);
          continue;
        }
        return this.outcomeFromError(error);
      }
    }
  }

  private outcomeFromError(error: unknown): CreateEventOutcome {
    if (error instanceof HttpErrorResponse) {
      const body = readErrorResponse(error.error);
      if (error.status === 401 && body?.code === INVALID_ACCESS_TOKEN) {
        this.session.end('expired');
      }
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
    // Incluye `permission_required`, `idempotency_key_reused`, transitorios agotados
    // y cualquier respuesta no prevista: nunca se interpreta como éxito.
    return { kind: 'failed', error: toApiError(error) };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
