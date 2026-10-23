import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { toApiError } from '../../../core/api/api-error';
import { ErrorResponseDto, readErrorResponse } from '../../../core/api/bff-web/contract';
import {
  BffWebNutritionApi,
  CREATE_NUTRITION_PLAN_ERROR_CODES,
  CreateNutritionPlanRequestDto,
  ETAG_HEADER,
  IDEMPOTENT_REPLAYED_HEADER,
  NUTRITION_HABITS_MISSING,
} from '../../../core/api/bff-web/nutrition.api';
import { SessionStore } from '../../../core/session/session.store';
import { SESSION_EXPIRED, accessTokenOrEnd, endSessionIfTokenRejected } from '../training-session';
import { FoodCatalogCache } from './food-catalog.cache';
import {
  CreateNutritionPlanOutcome,
  FoodCatalog,
  NutritionPlan,
  NutritionPlanDraft,
  NutritionPlanViolation,
  NutritionPlansPage,
  toFoodCatalog,
  toNutritionPlan,
} from './nutrition-plan.model';
import { NutritionGateway } from './nutrition.gateway';

const CODES = CREATE_NUTRITION_PLAN_ERROR_CODES;
const NOT_MODIFIED = 304;

/**
 * Implementación de HU014 sobre `GET /v1/food-catalog`, `POST
 * /v1/nutrition-plans`, `GET /v1/nutrition-plans/{plan_id}` y `GET
 * /v1/me/nutrition-plans` del BFF web (contrato 0.18.0).
 */
@Injectable()
export class HttpNutritionGateway extends NutritionGateway {
  private readonly api = inject(BffWebNutritionApi);
  private readonly session = inject(SessionStore);
  private readonly cache = inject(FoodCatalogCache);

  async loadCatalog(): Promise<FoodCatalog> {
    const token = this.tokenOrThrow();
    const cached = this.cache.catalog;
    try {
      const response = await firstValueFrom(this.api.getFoodCatalog(token, this.cache.etag));
      if (response.body === null) {
        throw new HttpErrorResponse({ status: response.status });
      }
      const catalog = toFoodCatalog(response.body);
      this.cache.store(response.headers.get(ETAG_HEADER), catalog);
      return catalog;
    } catch (error) {
      // `304`: el catálogo en memoria sigue vigente.
      if (error instanceof HttpErrorResponse && error.status === NOT_MODIFIED && cached) {
        return cached;
      }
      endSessionIfTokenRejected(this.session, error);
      throw error;
    }
  }

  async createPlan(
    draft: NutritionPlanDraft,
    idempotencyKey: string,
  ): Promise<CreateNutritionPlanOutcome> {
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
        plan: toNutritionPlan(response.body),
        warnings: response.body.warnings.filter((warning) => warning === NUTRITION_HABITS_MISSING),
        replayed: response.headers.get(IDEMPOTENT_REPLAYED_HEADER) === 'true',
      };
    } catch (error) {
      endSessionIfTokenRejected(this.session, error);
      return outcomeFromError(error);
    }
  }

  async getPlan(planId: string): Promise<NutritionPlan> {
    const token = this.tokenOrThrow();
    try {
      return toNutritionPlan(await firstValueFrom(this.api.getPlan(token, planId)));
    } catch (error) {
      endSessionIfTokenRejected(this.session, error);
      throw error;
    }
  }

  async loadMyPlans(cursor: string | null): Promise<NutritionPlansPage> {
    const token = this.tokenOrThrow();
    try {
      const page = await firstValueFrom(this.api.getMyPlans(token, cursor));
      return { plans: page.items.map(toNutritionPlan), nextCursor: page.next_cursor };
    } catch (error) {
      endSessionIfTokenRejected(this.session, error);
      throw error;
    }
  }

  private tokenOrThrow(): string {
    const token = accessTokenOrEnd(this.session);
    if (token === null) {
      throw new HttpErrorResponse({ status: 401 });
    }
    return token;
  }
}

function toRequest(draft: NutritionPlanDraft): CreateNutritionPlanRequestDto {
  return {
    athlete_email: draft.athleteEmail,
    title: draft.title,
    objectives: [...draft.objectives],
    start_date: draft.startDate,
    end_date: draft.endDate,
    meals: draft.meals.map((meal) => ({
      meal_type: meal.mealType,
      items: meal.items.map((item) => ({
        food_code: item.foodCode,
        quantity: item.quantity,
        unit: item.unit,
      })),
    })),
  };
}

function outcomeFromError(error: unknown): CreateNutritionPlanOutcome {
  if (error instanceof HttpErrorResponse) {
    const body = readErrorResponse(error.error);
    if (error.status === 403 && body?.code === CODES.athleteAuthorizationRequired) {
      return { kind: 'athlete_not_authorized' };
    }
    if (
      error.status === 422 &&
      (body?.code === CODES.nutritionPlanInvalid || body?.code === CODES.validationError)
    ) {
      const violations = toViolations(body);
      if (violations.length > 0) {
        return { kind: 'invalid', violations };
      }
    }
  }
  // Incluye `permission_required`, `idempotency_key_reused`, `upstream_unavailable`
  // (Usuarios caído, CA6), `upstream_timeout`, sin conexión y cualquier respuesta no
  // prevista: nunca se interpreta como éxito.
  return { kind: 'failed', error: toApiError(error) };
}

/** `details[].field` llega como `body.<ruta>`; se conserva la ruta sin el prefijo. */
function toViolations(body: ErrorResponseDto): NutritionPlanViolation[] {
  return (body.details ?? []).map((detail) => ({
    path: (detail.field ?? '').replace(/^body\.?/, ''),
    issue: detail.issue,
  }));
}
