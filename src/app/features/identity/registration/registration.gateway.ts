import { RegistrationDraft, RegistrationOptions, RegistrationOutcome } from './registration.model';

/**
 * Puerto hacia el BFF web para HU001. La pantalla depende solo de esta
 * abstracción; el adaptador HTTP traduce el contrato OpenAPI a estos tipos.
 *
 * BLOQUEADO: `bff-web.openapi.json` 0.1.0 no expone operaciones de registro.
 * No existe implementación ni ruta registrada hasta que el contrato se publique.
 */
export abstract class RegistrationGateway {
  /** Catálogo de tipos de actor y políticas vigentes. */
  abstract loadOptions(): Promise<RegistrationOptions>;

  /**
   * @param idempotencyKey igual en los reintentos del mismo intento lógico (CA5).
   * Debe resolver siempre con un `RegistrationOutcome`; los fallos técnicos se
   * expresan como `{ kind: 'failed' }`, nunca como éxito.
   */
  abstract register(draft: RegistrationDraft, idempotencyKey: string): Promise<RegistrationOutcome>;
}
