import { Routes } from '@angular/router';

import { ActorType } from './core/session/session.store';
import { requireActor } from './shell/navigation/actor.guards';

/** Área autenticada de un actor (ADR-025): menú lateral y su inicio. */
function actorArea(path: string, actor: ActorType): Routes[number] {
  return {
    path,
    canActivate: [requireActor(actor)],
    data: { actor },
    loadComponent: () =>
      import('./shell/actor-shell/actor-shell').then((module) => module.ActorShell),
    children: [
      {
        path: 'inicio',
        loadComponent: () =>
          import('./shell/actor-home/actor-home-page').then((module) => module.ActorHomePage),
      },
      { path: '', pathMatch: 'full', redirectTo: 'inicio' },
    ],
  };
}

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
    path: 'registro',
    loadChildren: () =>
      import('./features/identity/registration/registration.routes').then(
        (module) => module.REGISTRATION_ROUTES,
      ),
  },
  // HU003 (CA7–CA10) y ADR-025: un inicio y un menú por tipo de actor.
  actorArea('deportista', 'athlete'),
  actorArea('organizador', 'organizer'),
  actorArea('profesional', 'service_provider'),
  {
    path: 'acceso-no-autorizado',
    loadComponent: () =>
      import('./shell/unauthorized/unauthorized-page').then((module) => module.UnauthorizedPage),
  },
  {
    path: 'status',
    loadComponent: () =>
      import('./technical/technical-status').then((module) => module.TechnicalStatus),
  },
  { path: '', pathMatch: 'full', redirectTo: 'iniciar-sesion' },
  { path: '**', redirectTo: 'iniciar-sesion' },
];
