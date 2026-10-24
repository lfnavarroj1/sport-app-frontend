import { OrganizerEvent } from '../publish-event/publish-event.model';
import { CalendarPage, CalendarQuery, EventConflicts } from './event-calendar.model';

/**
 * Puerto hacia el BFF web para el calendario del organizador (HU023, ADR-040).
 * Las pantallas dependen solo de esta abstracción; `HttpEventCalendarGateway`
 * traduce el contrato bff-web 0.18.0. Todas las consultas rechazan con el error
 * original: un fallo nunca se interpreta como lista vacía.
 */
export abstract class EventCalendarGateway {
  /**
   * Página de eventos publicados del periodo. `cursor` es el `nextCursor` de la
   * página anterior, sin modificar, y se envía con la misma consulta.
   */
  abstract loadEvents(query: CalendarQuery, cursor: string | null): Promise<CalendarPage>;

  /** Todos los eventos propios (`DRAFT` y `PUBLISHED`), para el selector de coincidencias. */
  abstract loadOwnEvents(): Promise<readonly OrganizerEvent[]>;

  /** Coincidencias de un evento propio con los publicados (CA2). */
  abstract loadConflicts(eventId: string): Promise<EventConflicts>;
}
