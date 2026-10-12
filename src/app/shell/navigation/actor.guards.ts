import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { LOGIN_PATH } from '../../core/session/session.guards';
import { ActorType, SessionStore } from '../../core/session/session.store';
import { UNAUTHORIZED_PATH } from './navigation.registry';

/**
 * Permite la ruta solo al actor indicado (ADR-025). Antes intenta recuperar la
 * sesión con la cookie (recarga de la pestaña). Sin sesión lleva al acceso; con la
 * sesión de otro actor lleva a `/acceso-no-autorizado`. Una URL directa, un
 * marcador o el botón Atrás pasan por esta guarda. El backend vuelve a validar.
 */
export function requireActor(actor: ActorType): CanActivateFn {
  return async () => {
    const session = inject(SessionStore);
    const router = inject(Router);
    await session.restore();
    const user = session.user();
    if (user === null) {
      return router.parseUrl(LOGIN_PATH);
    }
    return user.actorType === actor || router.parseUrl(UNAUTHORIZED_PATH);
  };
}
