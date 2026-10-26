import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { toApiError } from '../../../core/api/api-error';
import {
  BffWebAffiliationApi,
  SUBSCRIPTION_CHANGE_ERROR_CODES,
  SUBSCRIPTION_IDEMPOTENT_REPLAYED_HEADER,
} from '../../../core/api/bff-web/affiliation.api';
import { readErrorResponse } from '../../../core/api/bff-web/contract';
import { SessionStore } from '../../../core/session/session.store';
import { MyPlanGateway } from './my-plan.gateway';
import {
  ChangeOutcome,
  MyPlan,
  PlanChoice,
  toCatalog,
  toChangeRequest,
  toSubscription,
} from './my-plan.model';

const INVALID_ACCESS_TOKEN = SUBSCRIPTION_CHANGE_ERROR_CODES.invalidAccessToken;
const VALIDATION_ERROR = SUBSCRIPTION_CHANGE_ERROR_CODES.validationError;

/** Fallos que se reintentan automáticamente: red, `502`, `503` y `504` (ADR-036, decisión 6). */
const TRANSIENT_STATUSES: readonly number[] = [0, 502, 503, 504];

/**
 * Esperas antes de cada reintento automático del cambio de plan: hasta tres,
 * progresivas. Configurable para las pruebas.
 */
export const SUBSCRIPTION_CHANGE_RETRY_DELAYS_MS = new InjectionToken<readonly number[]>(
  'SUBSCRIPTION_CHANGE_RETRY_DELAYS_MS',
  { factory: () => [1_000, 2_000, 4_000] },
);

/**
 * Implementación de HU016 sobre `GET /v1/plans`, `GET /v1/me/subscription` y
 * `POST /v1/me/subscription/changes` (contrato bff-web 0.20.0). El deportista sale
 * del token.
 */
@Injectable()
export class HttpMyPlanGateway extends MyPlanGateway {
  private readonly api = inject(BffWebAffiliationApi);
  private readonly session = inject(SessionStore);
  private readonly retryDelays = inject(SUBSCRIPTION_CHANGE_RETRY_DELAYS_MS);

  async load(): Promise<MyPlan> {
    const token = this.session.accessToken();
    if (token === null) {
      this.session.end('expired');
      throw new HttpErrorResponse({ status: 401 });
    }
    try {
      const [plans, subscription] = await Promise.all([
        firstValueFrom(this.api.getPlans(token)),
        firstValueFrom(this.api.getSubscription(token)),
      ]);
      return { catalog: toCatalog(plans), subscription: toSubscription(subscription) };
    } catch (error) {
      this.endSessionIfTokenRejected(error);
      throw error;
    }
  }

  async change(
    choice: PlanChoice,
    idempotencyKey: string,
    onRetry?: (attempt: number) => void,
  ): Promise<ChangeOutcome> {
    const body = toChangeRequest(choice);
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
          this.api.changeSubscription(token, body, idempotencyKey),
        );
        if (response.body === null) {
          // Un 200 sin cuerpo no confirma el cambio: no se presenta como éxito.
          return { kind: 'failed', error: toApiError(null) };
        }
        return {
          kind: 'changed',
          subscription: toSubscription(response.body),
          replayed: response.headers.get(SUBSCRIPTION_IDEMPOTENT_REPLAYED_HEADER) === 'true',
        };
      } catch (error) {
        const transient =
          error instanceof HttpErrorResponse && TRANSIENT_STATUSES.includes(error.status);
        if (transient && attempt < this.retryDelays.length) {
          // Misma clave: si el intento anterior sí cambió el plan, el BFF repite el resultado.
          onRetry?.(attempt + 1);
          await delay(this.retryDelays[attempt]);
          continue;
        }
        return this.outcomeFromError(error);
      }
    }
  }

  private outcomeFromError(error: unknown): ChangeOutcome {
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
    // Incluye los `409`, `404 plan_not_found`, `403`, transitorios agotados y
    // cualquier respuesta no prevista: nunca es éxito.
    return { kind: 'failed', error: toApiError(error) };
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
