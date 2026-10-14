import { AvailabilityFilters, AvailabilityPage } from './availability.model';

/**
 * Puerto hacia el BFF web para la disponibilidad de servicios (HU020).
 * `HttpAvailabilityGateway` traduce el contrato bff-web 0.12.0.
 */
export abstract class AvailabilityGateway {
  /**
   * Página del catálogo con los filtros indicados. `cursor` es el `nextCursor` de
   * la página anterior, sin modificar; `null` para la primera. Rechaza con el
   * error original si la consulta falla: nunca se interpreta como catálogo vacío.
   */
  abstract loadPage(filters: AvailabilityFilters, cursor: string | null): Promise<AvailabilityPage>;
}
