import { AccountStatement, MovementsPage } from './account-statement.model';

/**
 * Puerto hacia el BFF web para el estado de cuenta (HU007, ADR-036).
 * `HttpAccountStatementGateway` traduce `GET /v1/me/account-statement`.
 */
export abstract class AccountStatementGateway {
  /**
   * Primera página: estado, suscripción vigente, compromisos y movimientos.
   * Rechaza con el error original: nunca se interpreta como un estado vacío.
   */
  abstract load(): Promise<AccountStatement>;

  /**
   * Página siguiente de movimientos.
   *
   * @param cursor `nextCursor` de la página anterior, sin modificar.
   */
  abstract loadMore(cursor: string): Promise<MovementsPage>;
}
