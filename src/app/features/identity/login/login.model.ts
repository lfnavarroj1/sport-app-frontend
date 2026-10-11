import { ApiError } from '../../../core/api/api-error';
import { ActorType, Session } from '../../../core/session/session.store';

export interface LoginCredentials {
  readonly email: string;
  readonly password: string;
}

/** Resultado del inicio de sesión, ya traducido desde el contrato por el adaptador. */
export type LoginOutcome =
  | { readonly kind: 'authenticated'; readonly session: Session }
  /** Credenciales incorrectas o cuenta deshabilitada: siempre el mismo mensaje (CA2, CA3). */
  | { readonly kind: 'invalid_credentials' }
  /** Control de abuso (CA4); `retryAfterSeconds` sale de `Retry-After` si llega. */
  | { readonly kind: 'too_many_attempts'; readonly retryAfterSeconds: number | null }
  | { readonly kind: 'failed'; readonly error: ApiError };

/**
 * Destino tras iniciar sesión según el tipo de cuenta. Decisión del responsable
 * (2026-10-10): mientras no existan áreas por rol, todos van al inicio común.
 */
export const HOME_BY_ACTOR_TYPE: Readonly<Record<ActorType, string>> = {
  athlete: '/inicio',
  organizer: '/inicio',
  service_provider: '/inicio',
};
