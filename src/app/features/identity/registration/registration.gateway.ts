import { RegistrationDraft, RegistrationOptions, RegistrationOutcome } from './registration.model';

/**
 * Puerto hacia el BFF web para HU001. La pantalla depende solo de esta
 * abstracción; `HttpRegistrationGateway` traduce el contrato bff-web 0.2.0.
 */
export abstract class RegistrationGateway {
  /**
   * Tipos de actor permitidos y versión vigente de las políticas. Falla si el
   * registro no está configurado en el ambiente.
   */
  abstract loadOptions(): Promise<RegistrationOptions>;

  /**
   * @param idempotencyKey igual en los reintentos del mismo intento lógico (CA5).
   * Debe resolver siempre con un `RegistrationOutcome`; los fallos técnicos se
   * expresan como `{ kind: 'failed' }`, nunca como éxito.
   */
  abstract register(draft: RegistrationDraft, idempotencyKey: string): Promise<RegistrationOutcome>;
}
