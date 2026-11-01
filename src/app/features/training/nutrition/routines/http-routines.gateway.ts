import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { toApiError } from '../../../../core/api/api-error';
import { readErrorResponse } from '../../../../core/api/bff-web/contract';
import {
  BffWebNutritionRoutinesApi,
  PUBLISH_ROUTINE_ERROR_CODES,
  RETIRE_ROUTINE_ERROR_CODES,
  ROUTINE_IDEMPOTENT_REPLAYED_HEADER,
  ROUTINE_LIMITS,
} from '../../../../core/api/bff-web/nutrition-routines.api';
import { SessionStore } from '../../../../core/session/session.store';
import {
  SESSION_EXPIRED,
  accessTokenOrEnd,
  endSessionIfTokenRejected,
} from '../../training-session';
import { RoutinesGateway } from './routines.gateway';
import {
  PublishOutcome,
  RetireOutcome,
  RoutineDraft,
  RoutinesPage,
  toNutritionRoutine,
  toPublishRoutineRequest,
} from './routines.model';

/** Fallos que se reintentan automáticamente: red, `502`, `503` y `504`. */
const TRANSIENT_STATUSES: readonly number[] = [0, 502, 503, 504];

/**
 * Esperas antes de cada reintento automático de publicar: hasta tres, progresivas.
 * Configurable para las pruebas.
 */
export const PUBLISH_ROUTINE_RETRY_DELAYS_MS = new InjectionToken<readonly number[]>(
  'PUBLISH_ROUTINE_RETRY_DELAYS_MS',
  { factory: () => [1_000, 2_000, 4_000] },
);

/**
 * Implementación de HU030 sobre `POST /v1/nutrition-routine-templates`,
 * `POST /v1/nutrition-routine-templates/{template_id}/retire` y
 * `GET /v1/me/nutrition-routine-templates` (contrato bff-web 0.34.0). El
 * profesional sale del token.
 */
@Injectable()
export class HttpRoutinesGateway extends RoutinesGateway {
  private readonly api = inject(BffWebNutritionRoutinesApi);
  private readonly session = inject(SessionStore);
  private readonly retryDelays = inject(PUBLISH_ROUTINE_RETRY_DELAYS_MS);

  async loadRoutines(cursor: string | null): Promise<RoutinesPage> {
    const token = accessTokenOrEnd(this.session);
    if (token === null) {
      throw new HttpErrorResponse({ status: 401 });
    }
    try {
      const page = await firstValueFrom(
        this.api.getMyRoutines(token, { limit: ROUTINE_LIMITS.listDefault, cursor }),
      );
      return { routines: page.items.map(toNutritionRoutine), nextCursor: page.next_cursor };
    } catch (error) {
      endSessionIfTokenRejected(this.session, error);
      throw error;
    }
  }

  async publish(
    draft: RoutineDraft,
    idempotencyKey: string,
    onRetry?: (attempt: number) => void,
  ): Promise<PublishOutcome> {
    const body = toPublishRoutineRequest(draft);
    for (let attempt = 0; ; attempt++) {
      const token = accessTokenOrEnd(this.session);
      if (token === null) {
        return { kind: 'failed', error: SESSION_EXPIRED };
      }
      try {
        const response = await firstValueFrom(this.api.publishRoutine(token, body, idempotencyKey));
        if (response.body === null) {
          // Una respuesta sin cuerpo no confirma la publicación: no se presenta como éxito.
          return { kind: 'failed', error: toApiError(null) };
        }
        return {
          kind: 'published',
          routine: toNutritionRoutine(response.body),
          replayed: response.headers.get(ROUTINE_IDEMPOTENT_REPLAYED_HEADER) === 'true',
        };
      } catch (error) {
        const transient =
          error instanceof HttpErrorResponse && TRANSIENT_STATUSES.includes(error.status);
        if (transient && attempt < this.retryDelays.length) {
          // Misma clave: si el intento anterior sí publicó, el BFF devuelve la misma rutina.
          onRetry?.(attempt + 1);
          await delay(this.retryDelays[attempt]);
          continue;
        }
        endSessionIfTokenRejected(this.session, error);
        const errorBody =
          error instanceof HttpErrorResponse ? readErrorResponse(error.error) : null;
        if (
          error instanceof HttpErrorResponse &&
          error.status === 422 &&
          errorBody?.code === PUBLISH_ROUTINE_ERROR_CODES.validationError
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

  async retire(routineId: string, expectedVersion: number): Promise<RetireOutcome> {
    const token = accessTokenOrEnd(this.session);
    if (token === null) {
      return { kind: 'failed', error: SESSION_EXPIRED };
    }
    try {
      const routine = await firstValueFrom(
        this.api.retireRoutine(token, routineId, { expected_version: expectedVersion }),
      );
      return { kind: 'retired', routine: toNutritionRoutine(routine) };
    } catch (error) {
      endSessionIfTokenRejected(this.session, error);
      const body = error instanceof HttpErrorResponse ? readErrorResponse(error.error) : null;
      if (body?.code === RETIRE_ROUTINE_ERROR_CODES.versionConflict) {
        const detail = (body.details ?? []).find((item) => item.field === 'expected_version');
        return {
          kind: 'conflict',
          currentVersion:
            detail !== undefined && /^\d+$/.test(detail.issue) ? Number(detail.issue) : null,
        };
      }
      // Incluye `template_not_found`, `permission_required` y transitorios: nunca es éxito.
      return { kind: 'failed', error: toApiError(error) };
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
