import { Session } from './session.store';

/** Resultado de pedir al BFF un access token nuevo con la cookie de la sesión. */
export type RefreshOutcome =
  | { readonly kind: 'renewed'; readonly session: Session }
  /** Sin cookie, vencida, revocada o reutilizada, o una respuesta inutilizable: no hay sesión. */
  | { readonly kind: 'rejected' }
  /** Sin conexión o BFF no disponible: puede reintentarse mientras el access token siga vigente. */
  | { readonly kind: 'unavailable' };

/**
 * Puerto hacia el BFF web para renovar la sesión (HU003). `SessionStore` depende
 * solo de esta abstracción; `HttpSessionRefresher` traduce el contrato bff-web.
 * Debe resolver siempre con un `RefreshOutcome`, nunca rechazar.
 */
export abstract class SessionRefresher {
  abstract refresh(): Promise<RefreshOutcome>;
}
