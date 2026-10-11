import { LoginCredentials, LoginOutcome } from './login.model';

/**
 * Puerto hacia el BFF web para HU003. La pantalla depende solo de esta
 * abstracción; `HttpLoginGateway` traduce el contrato bff-web.
 */
export abstract class LoginGateway {
  /**
   * Debe resolver siempre con un `LoginOutcome`; los fallos técnicos se expresan
   * como `{ kind: 'failed' }`, nunca como sesión iniciada.
   */
  abstract login(credentials: LoginCredentials): Promise<LoginOutcome>;
}
