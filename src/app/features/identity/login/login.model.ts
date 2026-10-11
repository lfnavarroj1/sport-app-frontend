import { ApiError } from '../../../core/api/api-error';
import { Session } from '../../../core/session/session.store';

export interface LoginCredentials {
  readonly email: string;
  readonly password: string;
}

/**
 * Resultado del inicio de sesión, ya traducido desde el contrato por el adaptador.
 * El destino posterior al ingreso depende del actor (`homeFor`, ADR-025).
 */
export type LoginOutcome =
  | { readonly kind: 'authenticated'; readonly session: Session }
  /** Credenciales incorrectas o cuenta deshabilitada: siempre el mismo mensaje (CA2, CA3). */
  | { readonly kind: 'invalid_credentials' }
  /** Control de abuso (CA4); `retryAfterSeconds` sale de `Retry-After` si llega. */
  | { readonly kind: 'too_many_attempts'; readonly retryAfterSeconds: number | null }
  /**
   * `actor_type` ausente o fuera del catálogo (CA10): no se inicia sesión ni se
   * asume un rol predeterminado.
   */
  | { readonly kind: 'unauthorized_actor' }
  | { readonly kind: 'failed'; readonly error: ApiError };
