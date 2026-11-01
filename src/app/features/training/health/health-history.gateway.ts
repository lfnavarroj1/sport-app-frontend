import { HealthFilters, HealthReportsPage, HealthScope } from './health-history.model';

/**
 * Puerto hacia el BFF web para el historial de molestias, incapacidades o lesiones
 * (HU012). `HttpHealthHistoryGateway` traduce el contrato bff-web 0.33.0.
 */
export abstract class HealthHistoryGateway {
  /**
   * Página del historial con los filtros indicados. `cursor` es el `nextCursor`
   * de la página anterior, sin modificar; `null` para la primera. Rechaza con el
   * error original si la consulta falla: nunca se interpreta como historial vacío.
   */
  abstract loadPage(
    scope: HealthScope,
    filters: HealthFilters,
    cursor: string | null,
  ): Promise<HealthReportsPage>;
}
