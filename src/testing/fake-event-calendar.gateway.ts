import { EventCalendarGateway } from '../app/features/events/event-calendar/event-calendar.gateway';
import {
  CalendarEvent,
  EventConflicts,
  toCalendarEvent,
  toEventConflicts,
} from '../app/features/events/event-calendar/event-calendar.model';
import {
  OrganizerEvent,
  toOrganizerEvent,
} from '../app/features/events/publish-event/publish-event.model';
import {
  EVENT_CONFLICTS_RESPONSES,
  MARCH_EVENTS,
  OWN_DRAFT,
} from './bff-web/event-calendar.fixtures';

/** Datos sintéticos de prueba, derivados del simulador del contrato. */
export const TEST_MARCH_EVENTS: readonly CalendarEvent[] = MARCH_EVENTS.map(toCalendarEvent);
export const TEST_OWN_DRAFT: OrganizerEvent = toOrganizerEvent(OWN_DRAFT);
export const TEST_CONFLICTS: EventConflicts = toEventConflicts(
  EVENT_CONFLICTS_RESPONSES.found.body,
);

/** Puerto controlado por las pruebas de componentes de HU023. */
export class FakeEventCalendarGateway extends EventCalendarGateway {
  loadEvents = jasmine
    .createSpy('loadEvents')
    .and.resolveTo({ events: TEST_MARCH_EVENTS, nextCursor: null });
  loadOwnEvents = jasmine.createSpy('loadOwnEvents').and.resolveTo([TEST_OWN_DRAFT]);
  loadConflicts = jasmine.createSpy('loadConflicts').and.resolveTo(TEST_CONFLICTS);
}
