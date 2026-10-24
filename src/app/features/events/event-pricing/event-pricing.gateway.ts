import { FeeOutcome, PricedEvent } from './event-pricing.model';

/**
 * Puerto hacia el BFF web para la tarifa de los eventos propios (HU025,
 * ADR-040). `HttpEventPricingGateway` traduce el contrato bff-web 0.26.0.
 */
export abstract class EventPricingGateway {
  /**
   * Todos los eventos propios (`DRAFT` y `PUBLISHED`) con su tarifa. Rechaza con
   * el error original: un fallo nunca se interpreta como lista vacía.
   */
  abstract loadOwnEvents(): Promise<readonly PricedEvent[]>;

  /**
   * Asigna la tarifa en `COP`.
   *
   * @param amount cadena decimal del contrato con dos decimales.
   * @param idempotencyKey igual en todos los intentos del mismo intento lógico.
   * @param onRetry se invoca antes de cada reintento automático (1, 2 o 3).
   * Resuelve siempre con un `FeeOutcome`; los fallos nunca se presentan como éxito.
   */
  abstract setFee(
    eventId: string,
    amount: string,
    expectedVersion: number,
    idempotencyKey: string,
    onRetry?: (attempt: number) => void,
  ): Promise<FeeOutcome>;

  /** Retira la tarifa (`fee = null`), con las mismas reglas que `setFee`. */
  abstract removeFee(
    eventId: string,
    expectedVersion: number,
    idempotencyKey: string,
    onRetry?: (attempt: number) => void,
  ): Promise<FeeOutcome>;
}
