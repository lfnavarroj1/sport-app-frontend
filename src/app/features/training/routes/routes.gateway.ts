import { PublishOutcome, RetireOutcome, RouteDraft, RoutesPage } from './routes.model';

/**
 * Puerto hacia el BFF web para las rutas del organizador (HU026, ADR-041).
 * `HttpRoutesGateway` traduce el contrato bff-web 0.23.0.
 */
export abstract class RoutesGateway {
  /**
   * Página de rutas propias (publicadas y retiradas). `cursor` es el `nextCursor`
   * anterior, sin modificar. Rechaza con el error original: nunca se interpreta
   * como lista vacía.
   */
  abstract loadRoutes(cursor: string | null): Promise<RoutesPage>;

  /**
   * Publica una ruta.
   *
   * @param idempotencyKey igual en todos los intentos del mismo intento lógico.
   * @param onRetry se invoca antes de cada reintento automático (1, 2 o 3).
   * Resuelve siempre con un `PublishOutcome`; los fallos nunca se expresan como éxito.
   */
  abstract publish(
    draft: RouteDraft,
    idempotencyKey: string,
    onRetry?: (attempt: number) => void,
  ): Promise<PublishOutcome>;

  /** Retira una ruta propia con la versión que muestra la pantalla. */
  abstract retire(routeId: string, expectedVersion: number): Promise<RetireOutcome>;
}
