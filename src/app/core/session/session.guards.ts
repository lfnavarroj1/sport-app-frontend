import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { SessionStore } from './session.store';

export const LOGIN_PATH = '/iniciar-sesion';

/**
 * Exige una sesión vigente para entrar a la ruta. Mejora la experiencia; el
 * control de acceso definitivo es del backend.
 */
export const requireSession: CanActivateFn = () =>
  inject(SessionStore).isAuthenticated() || inject(Router).parseUrl(LOGIN_PATH);
