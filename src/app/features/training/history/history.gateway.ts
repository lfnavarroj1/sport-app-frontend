import { HistoryFilters, HistoryPage, HistoryScope } from './history.model';

/**
 * Puerto hacia el BFF web para el historial de entrenamiento (HU011).
 * `HttpHistoryGateway` traduce el contrato bff-web 0.8.0.
 */
export abstract class HistoryGateway {
  /**
   * Página del historial con los filtros indicados. `cursor` es el `nextCursor`
   * de la página anterior, sin modificar; `null` para la primera. Rechaza con el
   * error original si la consulta falla: nunca se interpreta como historial vacío.
   */
  abstract loadPage(
    scope: HistoryScope,
    filters: HistoryFilters,
    cursor: string | null,
  ): Promise<HistoryPage>;
}
