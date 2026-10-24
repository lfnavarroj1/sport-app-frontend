import { OrganizerEvent } from '../publish-event/publish-event.model';
import { AttendeeFilter, AttendeesPage } from './attendees.model';

/**
 * Puerto hacia el BFF web para consultar inscritos (HU022, ADR-039).
 * `HttpAttendeesGateway` traduce el contrato bff-web 0.22.0. Las consultas
 * rechazan con el error original: un fallo nunca se interpreta como lista vacía.
 */
export abstract class AttendeesGateway {
  /** Todos los eventos propios (`DRAFT` y `PUBLISHED`), para el selector. */
  abstract loadOwnEvents(): Promise<readonly OrganizerEvent[]>;

  /**
   * Página de inscritos de un evento propio. `cursor` es el `nextCursor` de la
   * página anterior, sin modificar, con el mismo filtro.
   */
  abstract loadAttendees(
    eventId: string,
    filter: AttendeeFilter,
    cursor: string | null,
  ): Promise<AttendeesPage>;
}
