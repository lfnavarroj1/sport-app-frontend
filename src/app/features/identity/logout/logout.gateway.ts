import { ApiError } from '../../../core/api/api-error';

/**
 * Resultado de pedir al BFF el cierre de sesión (HU004), ya traducido desde el
 * contrato:
 * - `revoked`: `204`; la sesión quedó revocada y el BFF borró la cookie.
 * - `unconfirmed`: `503`/`504`; el BFF borró la cookie (cierre local garantizado),
 *   pero Usuarios no confirmó la revocación remota.
 * - `failed`: sin conexión, `403 origin_not_allowed` o una respuesta no prevista;
 *   la cookie sigue en el navegador, así que la sesión no se da por cerrada.
 */
export type LogoutOutcome =
  | { readonly kind: 'revoked' }
  | { readonly kind: 'unconfirmed' }
  | { readonly kind: 'failed'; readonly error: ApiError };

/**
 * Puerto hacia el BFF web para cerrar la sesión (HU004).
 * `HttpLogoutGateway` traduce el contrato bff-web 0.16.0.
 */
export abstract class LogoutGateway {
  /** Resuelve siempre con un `LogoutOutcome`; nunca rechaza. */
  abstract logout(): Promise<LogoutOutcome>;
}
