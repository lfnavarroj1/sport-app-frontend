import { HttpErrorResponse, HttpResponse } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';

import { toApiError } from '../../../core/api/api-error';
import { readErrorResponse } from '../../../core/api/bff-web/contract';
import {
  BffWebEventsApi,
  EVENT_FEE_CURRENCY,
  EVENT_FEE_ERROR_CODES,
  EVENT_IDEMPOTENT_REPLAYED_HEADER,
  MY_EVENTS_LIMIT,
  MyEventsResponseDto,
  OwnEventResponseDto,
} from '../../../core/api/bff-web/events.api';
import { SessionStore } from '../../../core/session/session.store';
import { EventPricingGateway } from './event-pricing.gateway';
import { FeeOutcome, PricedEvent, toPricedEvent } from './event-pricing.model';

const INVALID_ACCESS_TOKEN = EVENT_FEE_ERROR_CODES.invalidAccessToken;
const VALIDATION_ERROR = EVENT_FEE_ERROR_CODES.validationError;
const VERSION_CONFLICT = EVENT_FEE_ERROR_CODES.versionConflict;

/** Estados transitorios que se reintentan automáticamente: sin red, `502`, `503` y `504`. */
const TRANSIENT_STATUSES: readonly number[] = [0, 502, 503, 504];

/**
 * Esperas antes de cada reintento automático de la tarifa: hasta tres,
 * progresivas, como en HU024. Configurable para las pruebas.
 */
export const EVENT_FEE_RETRY_DELAYS_MS = new InjectionToken<readonly number[]>(
  'EVENT_FEE_RETRY_DELAYS_MS',
  { factory: () => [1_000, 2_000, 4_000] },
);

/**
 * Implementación de HU025 sobre `GET /v1/me/events`, `PUT` y
 * `DELETE /v1/events/{event_id}/fee` (contrato bff-web 0.26.0). El organizador
 * sale del token; la moneda es siempre `COP`. La respuesta del comando es la del
 * modelo de escritura: se presenta sin esperar la proyección.
 */
@Injectable()
export class HttpEventPricingGateway extends EventPricingGateway {
  private readonly api = inject(BffWebEventsApi);
  private readonly session = inject(SessionStore);
  private readonly retryDelays = inject(EVENT_FEE_RETRY_DELAYS_MS);

  async loadOwnEvents(): Promise<readonly PricedEvent[]> {
    const token = this.tokenOrEnd();
    const events: PricedEvent[] = [];
    let cursor: string | null = null;
    try {
      do {
        const page: MyEventsResponseDto = await firstValueFrom(
          this.api.getMyEvents(token, { limit: MY_EVENTS_LIMIT.max, cursor }),
        );
        events.push(...page.items.map(toPricedEvent));
        cursor = page.next_cursor;
      } while (cursor !== null);
      return events;
    } catch (error) {
      this.endSessionIfTokenRejected(error);
      throw error;
    }
  }

  setFee(
    eventId: string,
    amount: string,
    expectedVersion: number,
    idempotencyKey: string,
    onRetry?: (attempt: number) => void,
  ): Promise<FeeOutcome> {
    return this.command(
      (token) =>
        this.api.putEventFee(
          token,
          eventId,
          { amount, currency: EVENT_FEE_CURRENCY, expected_version: expectedVersion },
          idempotencyKey,
        ),
      onRetry,
    );
  }

  removeFee(
    eventId: string,
    expectedVersion: number,
    idempotencyKey: string,
    onRetry?: (attempt: number) => void,
  ): Promise<FeeOutcome> {
    return this.command(
      (token) => this.api.deleteEventFee(token, eventId, expectedVersion, idempotencyKey),
      onRetry,
    );
  }

  private async command(
    send: (token: string) => Observable<HttpResponse<OwnEventResponseDto>>,
    onRetry?: (attempt: number) => void,
  ): Promise<FeeOutcome> {
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
        const response = await firstValueFrom(send(token));
        if (response.body === null) {
          // Un 200 sin cuerpo no confirma el cambio: no se presenta como éxito.
          return { kind: 'failed', error: toApiError(null) };
        }
        return {
          kind: 'updated',
          event: toPricedEvent(response.body),
          replayed: response.headers.get(EVENT_IDEMPOTENT_REPLAYED_HEADER) === 'true',
        };
      } catch (error) {
        const transient =
          error instanceof HttpErrorResponse && TRANSIENT_STATUSES.includes(error.status);
        if (transient && attempt < this.retryDelays.length) {
          // Misma clave: si el intento anterior sí se aplicó, el BFF devuelve el mismo resultado.
          onRetry?.(attempt + 1);
          await delay(this.retryDelays[attempt]);
          continue;
        }
        return this.outcomeFromError(error);
      }
    }
  }

  private outcomeFromError(error: unknown): FeeOutcome {
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
      if (error.status === 409 && body?.code === VERSION_CONFLICT) {
        // `details[0]` = `{field: expected_version, issue: <versión vigente>}`.
        const current = Number(
          body.details?.find((detail) => detail.field === 'expected_version')?.issue,
        );
        return {
          kind: 'conflict',
          currentVersion: Number.isInteger(current) && current > 0 ? current : null,
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
