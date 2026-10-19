import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes } from '@angular/router';

import { SessionStore } from '../../../core/session/session.store';
import { homeFor } from '../../../shell/navigation/navigation.registry';
import { HttpLoginGateway } from './http-login.gateway';
import { LoginGateway } from './login.gateway';
import { LoginPage } from './login-page/login-page';

/**
 * Con una sesión vigente, o recuperada con la cookie al recargar, no se vuelve a
 * mostrar el formulario de acceso.
 */
const redirectAuthenticated: CanActivateFn = async () => {
  const session = inject(SessionStore);
  const router = inject(Router);
  await session.restore();
  const user = session.user();
  return user === null || router.parseUrl(homeFor(user.actorType));
};

/** HU003: inicio de sesión. Se carga de forma diferida desde `app.routes.ts`. */
export const LOGIN_ROUTES: Routes = [
  {
    path: '',
    component: LoginPage,
    canActivate: [redirectAuthenticated],
    providers: [{ provide: LoginGateway, useClass: HttpLoginGateway }],
  },
];
