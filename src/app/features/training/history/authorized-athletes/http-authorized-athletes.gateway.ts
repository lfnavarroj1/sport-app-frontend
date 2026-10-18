import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import {
  BffWebTrainingHistoryApi,
  TRAINING_HISTORY_LIMIT,
  TrainingAthletesResponseDto,
} from '../../../../core/api/bff-web/training-history.api';
import { SessionStore } from '../../../../core/session/session.store';
import { accessTokenOrEnd, endSessionIfTokenRejected } from '../../training-session';
import { AuthorizedAthletesGateway } from './authorized-athletes.gateway';
import { AuthorizedAthletesPage } from './authorized-athletes.model';

/**
 * Implementación de CA5 sobre `GET /v1/me/training-athletes` (contrato bff-web
 * 0.15.0). El BFF deriva los deportistas del token; el cliente solo envía el
 * tamaño de página por defecto del contrato y el cursor.
 */
@Injectable()
export class HttpAuthorizedAthletesGateway extends AuthorizedAthletesGateway {
  private readonly api = inject(BffWebTrainingHistoryApi);
  private readonly session = inject(SessionStore);

  async loadPage(cursor: string | null): Promise<AuthorizedAthletesPage> {
    const token = accessTokenOrEnd(this.session);
    if (token === null) {
      throw new HttpErrorResponse({ status: 401 });
    }
    try {
      const response = await firstValueFrom(
        this.api.getTrainingAthletes(token, { limit: TRAINING_HISTORY_LIMIT.default, cursor }),
      );
      return toPage(response);
    } catch (error) {
      endSessionIfTokenRejected(this.session, error);
      throw error;
    }
  }
}

function toPage(response: TrainingAthletesResponseDto): AuthorizedAthletesPage {
  return {
    athletes: response.items.map((item) => ({
      id: item.athlete_id,
      fullName: item.full_name,
      email: item.email,
      authorizedAt: item.authorized_at,
    })),
    nextCursor: response.next_cursor,
  };
}
