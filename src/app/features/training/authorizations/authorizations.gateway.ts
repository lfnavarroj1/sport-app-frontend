import { GrantOutcome, RevokeOutcome } from './authorizations.model';

/**
 * Puerto hacia el BFF web para las autorizaciones del deportista (HU010).
 * `HttpAuthorizationsGateway` traduce el contrato bff-web 0.8.0. Ambos métodos
 * resuelven siempre; los fallos se expresan como `{ kind: 'failed' }`.
 */
export abstract class AuthorizationsGateway {
  /** Autoriza al profesional con ese correo exacto. Repetirlo no duplica nada. */
  abstract grant(professionalEmail: string): Promise<GrantOutcome>;

  abstract revoke(professionalId: string): Promise<RevokeOutcome>;
}
