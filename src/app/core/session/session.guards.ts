import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { SessionStore } from './session.store';

export const LOGIN_PATH = '/iniciar-sesion';

/**
 * Exige una sesión vigente para entrar a la ruta; antes intenta recuperarla con la
 * cookie (recarga de la pestaña). Mejora la experiencia; el control de acceso
 * definitivo es del backend.
 */
export const requireSession: CanActivateFn = async () => {
  const session = inject(SessionStore);
  const router = inject(Router);
  await session.restore();
  return session.isAuthenticated() || router.parseUrl(LOGIN_PATH);
};
