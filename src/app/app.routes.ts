import { Routes } from '@angular/router';

/**
 * Cada feature de dominio (`features/<dominio>`) se registra aquí con carga
 * diferida cuando una HU autorizada la implemente.
 */
export const routes: Routes = [
  {
    // HU003 (esqueleto): punto de entrada; desde aquí se llega al registro.
    path: 'iniciar-sesion',
    loadChildren: () =>
      import('./features/identity/login/login.routes').then((module) => module.LOGIN_ROUTES),
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
