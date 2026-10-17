import { Routes } from '@angular/router';

import { ActorType } from './core/session/session.store';
import { requireActor } from './shell/navigation/actor.guards';

/**
 * Área autenticada de un actor (ADR-025): menú lateral, su inicio y las features
 * de dominio del actor, cada una con carga diferida.
 */
function actorArea(path: string, actor: ActorType, features: Routes = []): Routes[number] {
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
      ...features,
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
  actorArea('deportista', 'athlete', [
    {
      // HU005: «Mi perfil», con los datos demográficos y fisiológicos (ADR-034).
      path: 'perfil',
      loadChildren: () =>
        import('./features/identity/profile/profile.routes').then(
          (module) => module.PROFILE_ROUTES,
        ),
    },
    {
      // HU010: el deportista autoriza a profesionales a asignarle planes.
      path: 'entrenamientos/planes',
      loadChildren: () =>
        import('./features/training/authorizations/authorizations.routes').then(
          (module) => module.AUTHORIZATIONS_ROUTES,
        ),
    },
    {
      // HU011: historial propio de entrenamiento.
      path: 'historial/entrenamientos',
      loadChildren: () =>
        import('./features/training/history/history.routes').then(
          (module) => module.ATHLETE_HISTORY_ROUTES,
        ),
    },
    {
      // HU020: la opción PREMIUM abre la misma pantalla de disponibilidad,
      // filtrada por medicina deportiva (ADR-038). Va antes de `servicios`.
      path: 'servicios/medico-deportivos',
      data: { presetCategory: 'SPORTS_MEDICINE' },
      loadChildren: () =>
        import('./features/services/availability/availability.routes').then(
          (module) => module.AVAILABILITY_ROUTES,
        ),
    },
    {
      // HU020: catálogo de servicios publicados y su disponibilidad.
      path: 'servicios',
      loadChildren: () =>
        import('./features/services/availability/availability.routes').then(
          (module) => module.AVAILABILITY_ROUTES,
        ),
    },
  ]),
  actorArea('organizador', 'organizer', [
    {
      // HU021: el organizador crea un evento en borrador (ADR-028).
      path: 'eventos/nuevo',
      loadChildren: () =>
        import('./features/events/create-event/create-event.routes').then(
          (module) => module.CREATE_EVENT_ROUTES,
        ),
    },
  ]),
  actorArea('profesional', 'service_provider', [
    {
      // HU010: el profesional crea, asigna y consulta planes de entrenamiento.
      path: 'entrenamientos/planes',
      loadChildren: () =>
        import('./features/training/plan-authoring/plan-authoring.routes').then(
          (module) => module.PLAN_AUTHORING_ROUTES,
        ),
    },
    {
      // HU011: historial de un deportista que autorizó al profesional.
      path: 'historial/entrenamientos',
      loadChildren: () =>
        import('./features/training/history/history.routes').then(
          (module) => module.PROFESSIONAL_HISTORY_ROUTES,
        ),
    },
  ]),
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
