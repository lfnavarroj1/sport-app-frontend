import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { toApiError } from '../../../core/api/api-error';
import { ErrorResponseDto, readErrorResponse } from '../../../core/api/bff-web/contract';
import {
  BffWebTrainingApi,
  CREATE_TRAINING_PLAN_ERROR_CODES,
  CreateTrainingPlanRequestDto,
  IDEMPOTENT_REPLAYED_HEADER,
} from '../../../core/api/bff-web/training.api';
import { SessionStore } from '../../../core/session/session.store';
import { TrainingPlan, toTrainingPlan } from '../training-plan.model';
import { SESSION_EXPIRED, accessTokenOrEnd, endSessionIfTokenRejected } from '../training-session';
import { PlanAuthoringGateway } from './plan-authoring.gateway';
import { CreatePlanOutcome, PlanDraft, PlanRuleViolation } from './plan-authoring.model';

const CODES = CREATE_TRAINING_PLAN_ERROR_CODES;

/**
 * Implementación de HU010 sobre `POST /v1/training-plans` y
 * `GET /v1/training-plans/{plan_id}` del BFF web (contrato 0.10.0).
 */
@Injectable()
export class HttpPlanAuthoringGateway extends PlanAuthoringGateway {
  private readonly api = inject(BffWebTrainingApi);
  private readonly session = inject(SessionStore);

  async createPlan(draft: PlanDraft, idempotencyKey: string): Promise<CreatePlanOutcome> {
    const token = accessTokenOrEnd(this.session);
    if (token === null) {
      return { kind: 'failed', error: SESSION_EXPIRED };
    }
    try {
      const response = await firstValueFrom(
        this.api.createPlan(token, toRequest(draft), idempotencyKey),
      );
      if (response.body === null) {
        // Un 201 sin cuerpo no confirma ningún plan: no se presenta como éxito.
        return { kind: 'failed', error: toApiError(null) };
      }
      return {
        kind: 'created',
        plan: toTrainingPlan(response.body),
        replayed: response.headers.get(IDEMPOTENT_REPLAYED_HEADER) === 'true',
      };
    } catch (error) {
      endSessionIfTokenRejected(this.session, error);
      return outcomeFromError(error);
    }
  }

  async getPlan(planId: string): Promise<TrainingPlan> {
    const token = accessTokenOrEnd(this.session);
    if (token === null) {
      throw new HttpErrorResponse({ status: 401 });
    }
    try {
      return toTrainingPlan(await firstValueFrom(this.api.getPlan(token, planId)));
    } catch (error) {
      endSessionIfTokenRejected(this.session, error);
      throw error;
    }
  }
}

function toRequest(draft: PlanDraft): CreateTrainingPlanRequestDto {
  return {
    athlete_email: draft.athleteEmail,
    title: draft.title,
    objectives: [...draft.objectives],
    start_date: draft.startDate,
    end_date: draft.endDate,
    sessions: draft.sessions.map((session) => ({
      scheduled_date: session.scheduledDate,
      sport: session.sport,
      duration_minutes: session.durationMinutes,
      intensity_rpe: session.intensityRpe,
    })),
  };
}

function outcomeFromError(error: unknown): CreatePlanOutcome {
  if (error instanceof HttpErrorResponse) {
    const body = readErrorResponse(error.error);
    if (error.status === 403 && body?.code === CODES.athleteAuthorizationRequired) {
      return { kind: 'athlete_not_authorized' };
    }
    if (
      error.status === 422 &&
      (body?.code === CODES.trainingPlanInvalid || body?.code === CODES.validationError)
    ) {
      const violations = toViolations(body);
      if (violations.length > 0) {
        return { kind: 'invalid', violations };
      }
    }
  }
  // Incluye `permission_required`, `idempotency_key_reused`, `upstream_unavailable`,
  // `upstream_timeout`, sin conexión y cualquier respuesta no prevista: nunca se
  // interpreta como éxito.
  return { kind: 'failed', error: toApiError(error) };
}

/** `details[].field` llega como `body.<ruta>`; se conserva la ruta sin el prefijo. */
function toViolations(body: ErrorResponseDto): PlanRuleViolation[] {
  return (body.details ?? []).map((detail) => ({
    path: (detail.field ?? '').replace(/^body\.?/, ''),
    issue: detail.issue,
  }));
}
