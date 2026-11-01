import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import {
  BffWebFoodIntakesApi,
  FOOD_INTAKES_LIMIT,
  FoodIntakesQueryDto,
} from '../../../../core/api/bff-web/food-intakes.api';
import { SessionStore } from '../../../../core/session/session.store';
import { accessTokenOrEnd, endSessionIfTokenRejected } from '../../training-session';
import { FoodIntakesGateway } from './food-intakes.gateway';
import {
  FoodIntakesPage,
  IntakeFilters,
  IntakeScope,
  toFoodIntakesPage,
} from './food-intakes.model';

/**
 * Implementación de HU013 sobre `GET /v1/me/food-intakes` y
 * `GET /v1/athletes/{athlete_id}/food-intakes` (contrato bff-web 0.32.0). Usa el
 * tamaño de página por defecto del contrato.
 */
@Injectable()
export class HttpFoodIntakesGateway extends FoodIntakesGateway {
  private readonly api = inject(BffWebFoodIntakesApi);
  private readonly session = inject(SessionStore);

  async loadPage(
    scope: IntakeScope,
    filters: IntakeFilters,
    cursor: string | null,
  ): Promise<FoodIntakesPage> {
    const token = accessTokenOrEnd(this.session);
    if (token === null) {
      throw new HttpErrorResponse({ status: 401 });
    }
    const query: FoodIntakesQueryDto = {
      from: filters.from,
      to: filters.to,
      meal_type: filters.mealType,
      limit: FOOD_INTAKES_LIMIT.default,
      cursor,
    };
    try {
      const response = await firstValueFrom(
        scope.kind === 'own'
          ? this.api.getOwnIntakes(token, query)
          : this.api.getAthleteIntakes(token, scope.athleteId, query),
      );
      return toFoodIntakesPage(response);
    } catch (error) {
      endSessionIfTokenRejected(this.session, error);
      throw error;
    }
  }
}
