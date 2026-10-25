import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { toApiError } from '../../../core/api/api-error';
import { readErrorResponse } from '../../../core/api/bff-web/contract';
import {
  BffWebTrainingTemplatesApi,
  PUBLISH_TEMPLATE_ERROR_CODES,
  RETIRE_TEMPLATE_ERROR_CODES,
  TEMPLATE_IDEMPOTENT_REPLAYED_HEADER,
  TEMPLATE_LIMITS,
} from '../../../core/api/bff-web/training-templates.api';
import { SessionStore } from '../../../core/session/session.store';
import { SESSION_EXPIRED, accessTokenOrEnd, endSessionIfTokenRejected } from '../training-session';
import { TemplatesGateway } from './templates.gateway';
import {
  PublishOutcome,
  RetireOutcome,
  TemplateDraft,
  TemplatesPage,
  toPublishTemplateRequest,
  toTrainingTemplate,
} from './templates.model';

/** Fallos que se reintentan automáticamente: red, `502`, `503` y `504`. */
const TRANSIENT_STATUSES: readonly number[] = [0, 502, 503, 504];

/**
 * Esperas antes de cada reintento automático de publicar: hasta tres, progresivas.
 * Configurable para las pruebas.
 */
export const PUBLISH_TEMPLATE_RETRY_DELAYS_MS = new InjectionToken<readonly number[]>(
  'PUBLISH_TEMPLATE_RETRY_DELAYS_MS',
  { factory: () => [1_000, 2_000, 4_000] },
);

/**
 * Implementación de HU028 sobre `POST /v1/training-plan-templates`,
 * `POST /v1/training-plan-templates/{template_id}/retire` y
 * `GET /v1/me/training-plan-templates` (contrato bff-web 0.24.0). El profesional
 * sale del token.
 */
@Injectable()
export class HttpTemplatesGateway extends TemplatesGateway {
  private readonly api = inject(BffWebTrainingTemplatesApi);
  private readonly session = inject(SessionStore);
  private readonly retryDelays = inject(PUBLISH_TEMPLATE_RETRY_DELAYS_MS);

  async loadTemplates(cursor: string | null): Promise<TemplatesPage> {
    const token = accessTokenOrEnd(this.session);
    if (token === null) {
      throw new HttpErrorResponse({ status: 401 });
    }
    try {
      const page = await firstValueFrom(
        this.api.getMyTemplates(token, { limit: TEMPLATE_LIMITS.listDefault, cursor }),
      );
      return { templates: page.items.map(toTrainingTemplate), nextCursor: page.next_cursor };
    } catch (error) {
      endSessionIfTokenRejected(this.session, error);
      throw error;
    }
  }

  async publish(
    draft: TemplateDraft,
    idempotencyKey: string,
    onRetry?: (attempt: number) => void,
  ): Promise<PublishOutcome> {
    const body = toPublishTemplateRequest(draft);
    for (let attempt = 0; ; attempt++) {
      const token = accessTokenOrEnd(this.session);
      if (token === null) {
        return { kind: 'failed', error: SESSION_EXPIRED };
      }
      try {
        const response = await firstValueFrom(
          this.api.publishTemplate(token, body, idempotencyKey),
        );
        if (response.body === null) {
          // Una respuesta sin cuerpo no confirma la publicación: no se presenta como éxito.
          return { kind: 'failed', error: toApiError(null) };
        }
        return {
          kind: 'published',
          template: toTrainingTemplate(response.body),
          replayed: response.headers.get(TEMPLATE_IDEMPOTENT_REPLAYED_HEADER) === 'true',
        };
      } catch (error) {
        const transient =
          error instanceof HttpErrorResponse && TRANSIENT_STATUSES.includes(error.status);
        if (transient && attempt < this.retryDelays.length) {
          // Misma clave: si el intento anterior sí publicó, el BFF devuelve la misma plantilla.
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
          errorBody?.code === PUBLISH_TEMPLATE_ERROR_CODES.validationError
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

  async retire(templateId: string, expectedVersion: number): Promise<RetireOutcome> {
    const token = accessTokenOrEnd(this.session);
    if (token === null) {
      return { kind: 'failed', error: SESSION_EXPIRED };
    }
    try {
      const template = await firstValueFrom(
        this.api.retireTemplate(token, templateId, { expected_version: expectedVersion }),
      );
      return { kind: 'retired', template: toTrainingTemplate(template) };
    } catch (error) {
      endSessionIfTokenRejected(this.session, error);
      const body = error instanceof HttpErrorResponse ? readErrorResponse(error.error) : null;
      if (body?.code === RETIRE_TEMPLATE_ERROR_CODES.versionConflict) {
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
