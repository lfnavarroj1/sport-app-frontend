import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { readErrorResponse } from '../../../core/api/bff-web/contract';
import {
  BffWebEventsApi,
  EVENT_ATTENDEES_ERROR_CODES,
  EVENT_ATTENDEES_LIMIT,
  MY_EVENTS_LIMIT,
  MyEventsResponseDto,
} from '../../../core/api/bff-web/events.api';
import { SessionStore } from '../../../core/session/session.store';
import { OrganizerEvent, toOrganizerEvent } from '../publish-event/publish-event.model';
import { AttendeesGateway } from './attendees.gateway';
import { AttendeeFilter, AttendeesPage, toAttendeesPage } from './attendees.model';

/**
 * Implementación de HU022 sobre `GET /v1/me/events` y
 * `GET /v1/me/events/{event_id}/registrations` (contrato bff-web 0.22.0). El
 * organizador sale del token. Los nombres de los inscritos son datos personales:
 * no se registran en consola ni se guardan fuera de la memoria de la pestaña.
 */
@Injectable()
export class HttpAttendeesGateway extends AttendeesGateway {
  private readonly api = inject(BffWebEventsApi);
  private readonly session = inject(SessionStore);

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

  async loadAttendees(
    eventId: string,
    filter: AttendeeFilter,
    cursor: string | null,
  ): Promise<AttendeesPage> {
    const token = this.tokenOrEnd();
    try {
      return toAttendeesPage(
        await firstValueFrom(
          this.api.getEventAttendees(token, eventId, {
            status: filter,
            limit: EVENT_ATTENDEES_LIMIT.default,
            cursor,
          }),
        ),
      );
    } catch (error) {
      this.endSessionIfTokenRejected(error);
      throw error;
    }
  }

  /** Access token vigente o, si venció, termina la sesión y rechaza como `401`. */
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
      readErrorResponse(error.error)?.code === EVENT_ATTENDEES_ERROR_CODES.invalidAccessToken
    ) {
      this.session.end('expired');
    }
  }
}
