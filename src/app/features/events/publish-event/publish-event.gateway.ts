import {
  EventDetail,
  EventStatus,
  OrganizerEventsPage,
  PublishOutcome,
} from './publish-event.model';

/**
 * Puerto hacia el BFF web para publicar eventos (HU024, ADR-033).
 * `HttpPublishEventGateway` traduce el contrato bff-web 0.16.0.
 */
export abstract class PublishEventGateway {
  /**
   * Página de eventos propios en `status`. `cursor` es el `nextCursor` anterior,
   * sin modificar; `null` para la primera. Rechaza con el error original: nunca
   * se interpreta como lista vacía.
   */
  abstract loadEvents(status: EventStatus, cursor: string | null): Promise<OrganizerEventsPage>;

  /** Detalle del evento; rechaza con el error original (`404` incluido). */
  abstract loadEvent(eventId: string): Promise<EventDetail>;

  /**
   * Publica el evento.
   *
   * @param idempotencyKey igual en todos los intentos del mismo intento lógico
   * (ADR-033, decisiones 4 y 8).
   * @param onRetry se invoca antes de cada reintento automático (1, 2 o 3).
   * Resuelve siempre con un `PublishOutcome`; los fallos se expresan como
   * `{ kind: 'failed' }`, nunca como éxito.
   */
  abstract publish(
    eventId: string,
    idempotencyKey: string,
    onRetry?: (attempt: number) => void,
  ): Promise<PublishOutcome>;
}
