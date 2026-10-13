import { CreateEventOutcome, EventDraft } from './create-event.model';

/**
 * Puerto hacia el BFF web para crear el borrador de un evento (HU021).
 * `HttpCreateEventGateway` traduce el contrato bff-web 0.10.0.
 */
export abstract class CreateEventGateway {
  /**
   * @param idempotencyKey igual en todos los intentos del mismo intento lógico
   * (ADR-028, decisiones 6 y 10).
   * @param onRetry se invoca antes de cada reintento automático (1, 2 o 3).
   * Resuelve siempre con un `CreateEventOutcome`; los fallos se expresan como
   * `{ kind: 'failed' }`, nunca como éxito.
   */
  abstract createEvent(
    draft: EventDraft,
    idempotencyKey: string,
    onRetry?: (attempt: number) => void,
  ): Promise<CreateEventOutcome>;
}
