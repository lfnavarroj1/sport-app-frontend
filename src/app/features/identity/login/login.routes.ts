import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes } from '@angular/router';

import { SessionStore } from '../../../core/session/session.store';
import { HttpLoginGateway } from './http-login.gateway';
import { LoginGateway } from './login.gateway';
import { HOME_BY_ACTOR_TYPE } from './login.model';
import { LoginPage } from './login-page/login-page';

/** Con una sesión vigente no se vuelve a mostrar el formulario de acceso. */
const redirectAuthenticated: CanActivateFn = () => {
  const user = inject(SessionStore).user();
  return user === null || inject(Router).parseUrl(HOME_BY_ACTOR_TYPE[user.actorType]);
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
