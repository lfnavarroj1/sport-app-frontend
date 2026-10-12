import { ACTOR_TYPES } from '../api/bff-web/contract';
import { WebSessionResponseDto } from '../api/bff-web/sessions.api';
import { ActorType, Session } from './session.store';

/**
 * Traduce `WebSessionResponse` (inicio o renovación) a la sesión de la pestaña:
 * identidad, access token y su vencimiento. Devuelve `null` si `actor_type` falta
 * o no está en el catálogo (CA10): no se asume un rol predeterminado.
 */
export function sessionFromResponse(
  response: WebSessionResponseDto,
  receivedAt: number,
): Session | null {
  const user = response.user;
  if (!isKnownActor(user?.actor_type)) {
    return null;
  }
  return {
    user: {
      id: user.user_id,
      fullName: user.full_name,
      email: user.email,
      actorType: user.actor_type,
    },
    accessToken: response.access_token,
    expiresAt: receivedAt + response.expires_in * 1000,
  };
}

function isKnownActor(value: unknown): value is ActorType {
  return (ACTOR_TYPES as readonly unknown[]).includes(value);
}
