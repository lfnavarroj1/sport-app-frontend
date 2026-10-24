/**
 * Versión del contrato bff-web que consume la aplicación, copiado sin cambios en
 * `contracts/bff-web.openapi.json`, y esquemas compartidos por sus operaciones.
 */
export const BFF_WEB_CONTRACT_VERSION = '0.23.0';

/** Enumeración `actor_type` (`RegisterUserRequest` y `SessionUser`). */
export const ACTOR_TYPES = ['athlete', 'organizer', 'service_provider'] as const;
export type ActorTypeDto = (typeof ACTOR_TYPES)[number];

export interface ErrorDetailDto {
  readonly field?: string | null;
  readonly issue: string;
}

/** Esquema `ErrorResponse` del contrato. */
export interface ErrorResponseDto {
  readonly code: string;
  readonly message: string;
  readonly correlation_id: string | null;
  readonly details?: readonly ErrorDetailDto[];
}

/** Devuelve el cuerpo como `ErrorResponse` si tiene su forma mínima. */
export function readErrorResponse(body: unknown): ErrorResponseDto | null {
  if (
    typeof body !== 'object' ||
    body === null ||
    typeof (body as ErrorResponseDto).code !== 'string'
  ) {
    return null;
  }
  return body as ErrorResponseDto;
}
