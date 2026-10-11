import { Routes } from '@angular/router';

import { requireSession } from './core/session/session.guards';

/**
 * Cada feature de dominio (`features/<dominio>`) se registra aquí con carga
 * diferida cuando una HU autorizada la implemente.
 */
export const routes: Routes = [
  {
    // HU003: punto de entrada; desde aquí se llega al registro (HU001).
    path: 'iniciar-sesion',
    loadChildren: () =>
      import('./features/identity/login/login.routes').then((module) => module.LOGIN_ROUTES),
  },
  {
    // HU003: inicio común tras iniciar sesión.
    path: 'inicio',
    canActivate: [requireSession],
    loadComponent: () =>
      import('./features/identity/home/home-page').then((module) => module.HomePage),
  },
  {
    path: 'registro',
    loadChildren: () =>
      import('./features/identity/registration/registration.routes').then(
        (module) => module.REGISTRATION_ROUTES,
      ),
  },
  {
    path: 'status',
    loadComponent: () =>
      import('./technical/technical-status').then((module) => module.TechnicalStatus),
  },
  { path: '', pathMatch: 'full', redirectTo: 'iniciar-sesion' },
  { path: '**', redirectTo: 'iniciar-sesion' },
];
