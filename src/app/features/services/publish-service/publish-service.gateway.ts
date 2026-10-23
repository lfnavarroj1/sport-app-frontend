import {
  OwnService,
  OwnServicesPage,
  PublishOutcome,
  ServiceStatus,
} from './publish-service.model';

/**
 * Puerto hacia el BFF web para publicar servicios (HU019, ADR-027).
 * `HttpPublishServiceGateway` traduce el contrato bff-web 0.16.0.
 */
export abstract class PublishServiceGateway {
  /**
   * Página de servicios propios en `status`. `cursor` es el `nextCursor` anterior,
   * sin modificar; `null` para la primera. Rechaza con el error original: nunca
   * se interpreta como lista vacía.
   */
  abstract loadServices(status: ServiceStatus, cursor: string | null): Promise<OwnServicesPage>;

  /** Servicio propio completo; rechaza con el error original (`404` incluido). */
  abstract loadService(serviceId: string): Promise<OwnService>;

  /**
   * Publica el servicio.
   *
   * @param idempotencyKey igual en todos los intentos del mismo intento lógico
   * (ADR-027, contrato de publicación, decisiones 2 y 8).
   * @param onRetry se invoca antes de cada reintento automático (1, 2 o 3).
   * Resuelve siempre con un `PublishOutcome`; los fallos se expresan como
   * `{ kind: 'failed' }`, nunca como éxito.
   */
  abstract publish(
    serviceId: string,
    idempotencyKey: string,
    onRetry?: (attempt: number) => void,
  ): Promise<PublishOutcome>;
}
