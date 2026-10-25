import { Account, AccountDraft, AccountSaveOutcome } from './account.model';

/**
 * Puerto hacia el BFF web para los datos personales de la cuenta (HU002).
 * `HttpAccountGateway` traduce el contrato bff-web 0.28.0.
 */
export abstract class AccountGateway {
  /**
   * Cuenta proyectada. Rechaza con el error original si la consulta falla:
   * nunca se interpreta como una cuenta vacía.
   */
  abstract loadAccount(): Promise<Account>;

  /**
   * Edita el nombre y el correo.
   *
   * @param expectedVersion versión vigente que ve el usuario.
   * @param idempotencyKey igual en todos los intentos del mismo intento lógico.
   * @param onRetry se invoca antes de cada reintento automático (1, 2 o 3).
   * Resuelve siempre con un `AccountSaveOutcome`.
   */
  abstract saveAccount(
    draft: AccountDraft,
    expectedVersion: number,
    idempotencyKey: string,
    onRetry?: (attempt: number) => void,
  ): Promise<AccountSaveOutcome>;
}
