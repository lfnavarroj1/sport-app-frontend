import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { readErrorResponse } from '../../../core/api/bff-web/contract';
import {
  BffWebEventsApi,
  MY_EVENTS_LIMIT,
  MyEventsResponseDto,
  PUBLISHED_EVENTS_ERROR_CODES,
  PUBLISHED_EVENTS_LIMIT,
} from '../../../core/api/bff-web/events.api';
import { SessionStore } from '../../../core/session/session.store';
import { OrganizerEvent, toOrganizerEvent } from '../publish-event/publish-event.model';
import {
  CalendarPage,
  CalendarQuery,
  EventConflicts,
  toCalendarEvent,
  toEventConflicts,
} from './event-calendar.model';
import { EventCalendarGateway } from './event-calendar.gateway';

const INVALID_ACCESS_TOKEN = PUBLISHED_EVENTS_ERROR_CODES.invalidAccessToken;

/**
 * Implementación de HU023 sobre `GET /v1/events`, `GET /v1/me/events` y
 * `GET /v1/me/events/{event_id}/conflicts` (contrato bff-web 0.18.0). El
 * organizador sale del token; la web no decide qué eventos coinciden: lo
 * calcula el BFF (ADR-040).
 */
@Injectable()
export class HttpEventCalendarGateway extends EventCalendarGateway {
  private readonly api = inject(BffWebEventsApi);
  private readonly session = inject(SessionStore);

  async loadEvents(query: CalendarQuery, cursor: string | null): Promise<CalendarPage> {
    const token = this.tokenOrEnd();
    try {
      const response = await firstValueFrom(
        this.api.getPublishedEvents(token, {
          from: query.period.from,
          to: query.period.to,
          discipline: query.discipline,
          city: query.city,
          limit: PUBLISHED_EVENTS_LIMIT.default,
          cursor,
        }),
      );
      return { events: response.items.map(toCalendarEvent), nextCursor: response.next_cursor };
    } catch (error) {
      this.endSessionIfTokenRejected(error);
      throw error;
    }
  }

  async loadOwnEvents(): Promise<readonly OrganizerEvent[]> {
    const token = this.tokenOrEnd();
    const events: OrganizerEvent[] = [];
    let cursor: string | null = null;
    try {
      do {
        const page: MyEventsResponseDto = await firstValueFrom(
          this.api.getMyEvents(token, { limit: MY_EVENTS_LIMIT.max, cursor }),
        );
        events.push(...page.items.map(toOrganizerEvent));
        cursor = page.next_cursor;
      } while (cursor !== null);
      return events;
    } catch (error) {
      this.endSessionIfTokenRejected(error);
      throw error;
    }
  }

  async loadConflicts(eventId: string): Promise<EventConflicts> {
    const token = this.tokenOrEnd();
    try {
      return toEventConflicts(await firstValueFrom(this.api.getEventConflicts(token, eventId)));
    } catch (error) {
      this.endSessionIfTokenRejected(error);
      throw error;
    }
  }

  /** Access token vigente o, si ya venció, termina la sesión y rechaza con `401`. */
  private tokenOrEnd(): string {
    const token = this.session.accessToken();
    if (token === null) {
      this.session.end('expired');
      throw new HttpErrorResponse({ status: 401 });
    }
    return token;
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
