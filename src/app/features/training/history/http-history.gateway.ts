import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import {
  BffWebTrainingHistoryApi,
  TRAINING_HISTORY_LIMIT,
  TrainingHistoryQueryDto,
  TrainingHistoryResponseDto,
} from '../../../core/api/bff-web/training-history.api';
import { SessionStore } from '../../../core/session/session.store';
import { accessTokenOrEnd, endSessionIfTokenRejected } from '../training-session';
import { HistoryGateway } from './history.gateway';
import { HistoryFilters, HistoryPage, HistoryScope } from './history.model';

/**
 * Implementación de HU011 sobre `GET /v1/training-history` y
 * `GET /v1/athletes/{athlete_id}/training-history` (contrato bff-web 0.10.0).
 * Usa el tamaño de página por defecto del contrato.
 */
@Injectable()
export class HttpHistoryGateway extends HistoryGateway {
  private readonly api = inject(BffWebTrainingHistoryApi);
  private readonly session = inject(SessionStore);

  async loadPage(
    scope: HistoryScope,
    filters: HistoryFilters,
    cursor: string | null,
  ): Promise<HistoryPage> {
    const token = accessTokenOrEnd(this.session);
    if (token === null) {
      throw new HttpErrorResponse({ status: 401 });
    }
    const query: TrainingHistoryQueryDto = {
      from: filters.from,
      to: filters.to,
      sport: filters.sport,
      limit: TRAINING_HISTORY_LIMIT.default,
      cursor,
    };
    try {
      const response = await firstValueFrom(
        scope.kind === 'own'
          ? this.api.getOwnHistory(token, query)
          : this.api.getAthleteHistory(token, scope.athleteId, query),
      );
      return toPage(response);
    } catch (error) {
      endSessionIfTokenRejected(this.session, error);
      throw error;
    }
  }
}

function toPage(response: TrainingHistoryResponseDto): HistoryPage {
  return {
    sessions: response.items.map((item) => ({
      id: item.session_id,
      planId: item.plan_id,
      sport: item.sport,
      startedAt: item.started_at,
      endedAt: item.ended_at,
      durationSeconds: item.duration_seconds,
    })),
    nextCursor: response.next_cursor,
    availableSports: [...response.filters.sports],
  };
}
