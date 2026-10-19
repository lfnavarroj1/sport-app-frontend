import { ApiError } from '../../../core/api/api-error';

/**
 * Autorización vigente del deportista a un profesional (HU010, decisión del
 * responsable del 2026-10-12): solo con ella el profesional puede crearle y
 * asignarle planes.
 */
export interface TrainingAuthorization {
  /** Correo que ingresó el deportista; el BFF solo devuelve identificadores. */
  readonly professionalEmail: string;
  readonly professionalId: string;
  readonly status: 'ACTIVE';
  /** Instante ISO 8601 en que se otorgó o reactivó. */
  readonly grantedAt: string;
  /** `200`: ya estaba activa; `201`: se creó o se reactivó. */
  readonly alreadyActive: boolean;
}

export type GrantOutcome =
  | { readonly kind: 'granted'; readonly authorization: TrainingAuthorization }
  /** El correo no es de un profesional (`404 professional_not_found`). */
  | { readonly kind: 'professional_not_found' }
  | { readonly kind: 'invalid_email' }
  | { readonly kind: 'failed'; readonly error: ApiError };

export type RevokeOutcome =
  { readonly kind: 'revoked' } | { readonly kind: 'failed'; readonly error: ApiError };
