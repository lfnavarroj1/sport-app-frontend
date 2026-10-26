import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { readErrorResponse } from '../../../core/api/bff-web/contract';
import {
  BffWebIntegratedCalendarApi,
  INTEGRATED_CALENDAR_ERROR_CODES,
} from '../../../core/api/bff-web/integrated-calendar.api';
import { SessionStore } from '../../../core/session/session.store';
import { CalendarPeriod } from '../event-calendar/event-calendar.model';
import { IntegratedCalendarGateway } from './integrated-calendar.gateway';
import { IntegratedCalendar, toIntegratedCalendar } from './integrated-calendar.model';

/**
 * Implementación de HU018 sobre `GET /v1/me/integrated-calendar` (contrato bff-web
 * 0.30.0). El actor y sus fuentes salen del token: la composición, la visibilidad
 * de los borradores y el recorte a 200 elementos los decide el BFF (ADR-039).
 */
@Injectable()
export class HttpIntegratedCalendarGateway extends IntegratedCalendarGateway {
  private readonly api = inject(BffWebIntegratedCalendarApi);
  private readonly session = inject(SessionStore);

  async load(period: CalendarPeriod): Promise<IntegratedCalendar> {
    const token = this.session.accessToken();
    if (token === null) {
      this.session.end('expired');
      throw new HttpErrorResponse({ status: 401 });
    }
    try {
      return toIntegratedCalendar(
        await firstValueFrom(this.api.getIntegratedCalendar(token, period)),
      );
    } catch (error) {
      if (
        error instanceof HttpErrorResponse &&
        error.status === 401 &&
        readErrorResponse(error.error)?.code === INTEGRATED_CALENDAR_ERROR_CODES.invalidAccessToken
      ) {
        this.session.end('expired');
      }
      throw error;
    }
  }
}
