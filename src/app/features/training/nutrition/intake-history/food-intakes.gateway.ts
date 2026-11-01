import { FoodIntakesPage, IntakeFilters, IntakeScope } from './food-intakes.model';

/**
 * Puerto hacia el BFF web para el historial de alimentación (HU013, ADR-037).
 * `HttpFoodIntakesGateway` traduce el contrato bff-web 0.32.0.
 */
export abstract class FoodIntakesGateway {
  /**
   * Página de consumos con los filtros indicados. `cursor` es el `nextCursor` de
   * la página anterior, sin modificar; `null` para la primera. Rechaza con el
   * error original si la consulta falla: nunca se interpreta como historial vacío.
   */
  abstract loadPage(
    scope: IntakeScope,
    filters: IntakeFilters,
    cursor: string | null,
  ): Promise<FoodIntakesPage>;
}
