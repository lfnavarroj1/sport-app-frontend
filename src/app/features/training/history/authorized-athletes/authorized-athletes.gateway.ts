import { AuthorizedAthletesPage } from './authorized-athletes.model';

/**
 * Puerto hacia el BFF web para la selección directa del profesional (HU011, CA5).
 * `HttpAuthorizedAthletesGateway` traduce el contrato bff-web 0.16.0.
 */
export abstract class AuthorizedAthletesGateway {
  /**
   * Página de deportistas que autorizaron al profesional. `cursor` es el
   * `nextCursor` de la página anterior, sin modificar; `null` para la primera.
   * Rechaza con el error original si la consulta falla: nunca se interpreta como
   * lista vacía.
   */
  abstract loadPage(cursor: string | null): Promise<AuthorizedAthletesPage>;
}
