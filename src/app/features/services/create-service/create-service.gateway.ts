import { CreateServiceOutcome, ServiceDraft } from './create-service.model';

/**
 * Puerto hacia el BFF web para crear el borrador de un servicio (HU015).
 * `HttpCreateServiceGateway` traduce el contrato bff-web 0.16.0.
 */
export abstract class CreateServiceGateway {
  /**
   * @param idempotencyKey igual en todos los intentos del mismo intento lógico
   * (ADR-027, decisión 12).
   * @param onRetry se invoca antes de cada reintento automático (1, 2 o 3).
   * Resuelve siempre con un `CreateServiceOutcome`; los fallos se expresan como
   * `{ kind: 'failed' }`, nunca como éxito.
   */
  abstract createService(
    draft: ServiceDraft,
    idempotencyKey: string,
    onRetry?: (attempt: number) => void,
  ): Promise<CreateServiceOutcome>;
}
