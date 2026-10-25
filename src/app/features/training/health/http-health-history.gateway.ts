import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import {
  BffWebHealthReportsApi,
  HEALTH_REPORTS_LIMIT,
  HealthReportHistoryResponseDto,
  HealthReportsQueryDto,
} from '../../../core/api/bff-web/health-reports.api';
import { SessionStore } from '../../../core/session/session.store';
import { accessTokenOrEnd, endSessionIfTokenRejected } from '../training-session';
import { HealthHistoryGateway } from './health-history.gateway';
import { HealthFilters, HealthReportsPage, HealthScope } from './health-history.model';

/**
 * Implementación de HU012 sobre `GET /v1/me/health-reports` y
 * `GET /v1/athletes/{athlete_id}/health-reports` (contrato bff-web 0.33.0).
 * Usa el tamaño de página por defecto del contrato. No registra respuestas ni
 * errores: son datos de salud.
 */
@Injectable()
export class HttpHealthHistoryGateway extends HealthHistoryGateway {
  private readonly api = inject(BffWebHealthReportsApi);
  private readonly session = inject(SessionStore);

  async loadPage(
    scope: HealthScope,
    filters: HealthFilters,
    cursor: string | null,
  ): Promise<HealthReportsPage> {
    const token = accessTokenOrEnd(this.session);
    if (token === null) {
      throw new HttpErrorResponse({ status: 401 });
    }
    const query: HealthReportsQueryDto = {
      from: filters.from,
      to: filters.to,
      type: filters.type,
      severity: filters.severity,
      limit: HEALTH_REPORTS_LIMIT.default,
      cursor,
    };
    try {
      const response = await firstValueFrom(
        scope.kind === 'own'
          ? this.api.getOwnReports(token, query)
          : this.api.getAthleteReports(token, scope.athleteId, query),
      );
      return toPage(response);
    } catch (error) {
      endSessionIfTokenRejected(this.session, error);
      throw error;
    }
  }
}

function toPage(response: HealthReportHistoryResponseDto): HealthReportsPage {
  return {
    reports: response.items.map((item) => ({
      id: item.report_id,
      type: item.type,
      bodyArea: item.body_area,
      severity: item.severity,
      occurredAt: item.occurred_at,
      expectedRecoveryDays: item.expected_recovery_days,
      status: item.status,
      sessionId: item.session_id,
    })),
    nextCursor: response.next_cursor,
  };
}
