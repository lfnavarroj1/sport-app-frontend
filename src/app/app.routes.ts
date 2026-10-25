import { Routes } from '@angular/router';

import { ActorType } from './core/session/session.store';
import { requireCapability } from './features/affiliation/require-capability.guard';
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
  {
    // HU001: aviso de tratamiento de datos, público y legible antes de aceptar.
    path: 'aviso-de-privacidad',
    loadChildren: () =>
      import('./features/identity/privacy-notice/privacy-notice.routes').then(
        (module) => module.PRIVACY_NOTICE_ROUTES,
      ),
  },
  // HU003 (CA7–CA10) y ADR-025: un inicio y un menú por tipo de actor.
  actorArea('deportista', 'athlete', [
    {
      // HU002 y HU005: «Mi perfil», con los datos personales (ADR-035) y el perfil
      // deportivo (ADR-034).
      path: 'perfil',
      loadChildren: () =>
        import('./features/identity/profile/profile.routes').then(
          (module) => module.PROFILE_ROUTES,
        ),
    },
    {
      // HU016: «Mi plan»: plan actual, comparación y cambio de plan (ADR-036).
      path: 'plan',
      loadChildren: () =>
        import('./features/affiliation/my-plan/my-plan.routes').then(
          (module) => module.MY_PLAN_ROUTES,
        ),
    },
    {
      // HU010: el deportista autoriza a profesionales a asignarle planes. HU016:
      // la capacidad del plan se exige también ante una URL directa.
      path: 'entrenamientos/planes',
      canActivate: [requireCapability('training.plan.manage')],
      loadChildren: () =>
        import('./features/training/authorizations/authorizations.routes').then(
          (module) => module.AUTHORIZATIONS_ROUTES,
        ),
    },
    {
      // HU012: «Mi salud», historial propio de molestias, incapacidades o lesiones
      // (ADR-037). Opción base, sin capacidad de plan.
      path: 'salud',
      loadChildren: () =>
        import('./features/training/health/health.routes').then(
          (module) => module.ATHLETE_HEALTH_ROUTES,
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
      // HU014: sección «Planes de alimentación» de «Mi alimentación» (ADR-037).
      path: 'alimentacion',
      loadChildren: () =>
        import('./features/training/nutrition/nutrition.routes').then(
          (module) => module.ATHLETE_NUTRITION_ROUTES,
        ),
    },
    {
      // HU020: la opción PREMIUM abre la misma pantalla de disponibilidad,
      // filtrada por medicina deportiva (ADR-038). Va antes de `servicios`.
      // HU016: sin la capacidad `PREMIUM` una URL directa no la abre.
      path: 'servicios/medico-deportivos',
      canActivate: [requireCapability('services.sports_medicine.access')],
      data: { presetCategory: 'SPORTS_MEDICINE' },
      loadChildren: () =>
        import('./features/services/availability/availability.routes').then(
          (module) => module.AVAILABILITY_ROUTES,
        ),
    },
    {
      // HU018: «Calendario deportivo», opción `FREE` del plan (ADR-039).
      path: 'calendario',
      canActivate: [requireCapability('calendar.sport.view')],
      loadChildren: () =>
        import('./features/events/calendar/integrated-calendar.routes').then(
          (module) => module.SPORT_CALENDAR_ROUTES,
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
      // HU002: «Mi perfil» del organizador, con solo sus datos personales (ADR-035).
      path: 'perfil',
      loadChildren: () =>
        import('./features/identity/profile/profile.routes').then(
          (module) => module.ACCOUNT_PROFILE_ROUTES,
        ),
    },
    {
      // HU021: el organizador crea un evento en borrador (ADR-028).
      path: 'eventos/nuevo',
      loadChildren: () =>
        import('./features/events/create-event/create-event.routes').then(
          (module) => module.CREATE_EVENT_ROUTES,
        ),
    },
    {
      // HU022: el organizador consulta los inscritos de sus eventos (ADR-039).
      path: 'eventos/inscritos',
      loadChildren: () =>
        import('./features/events/attendees/attendees.routes').then(
          (module) => module.ATTENDEES_ROUTES,
        ),
    },
    {
      // HU024: el organizador revisa sus eventos y publica un borrador (ADR-033).
      path: 'eventos/publicacion',
      loadChildren: () =>
        import('./features/events/publish-event/publish-event.routes').then(
          (module) => module.PUBLISH_EVENT_ROUTES,
        ),
    },
    {
      // HU025: el organizador asigna o retira la tarifa de sus eventos (ADR-040).
      path: 'eventos/tarifas',
      loadChildren: () =>
        import('./features/events/event-pricing/event-pricing.routes').then(
          (module) => module.EVENT_PRICING_ROUTES,
        ),
    },
    {
      // HU026: el organizador publica rutas y retira las propias (ADR-041).
      path: 'rutas',
      loadChildren: () =>
        import('./features/training/routes/organizer-routes.routes').then(
          (module) => module.ORGANIZER_ROUTES_ROUTES,
        ),
    },
    {
      // HU023: el organizador consulta los eventos publicados y sus coincidencias (ADR-040).
      path: 'eventos/calendario',
      loadChildren: () =>
        import('./features/events/event-calendar/event-calendar.routes').then(
          (module) => module.EVENT_CALENDAR_ROUTES,
        ),
    },
    {
      // HU018: calendario integrado de los eventos propios del organizador (ADR-039).
      path: 'calendario',
      loadChildren: () =>
        import('./features/events/calendar/integrated-calendar.routes').then(
          (module) => module.INTEGRATED_CALENDAR_ROUTES,
        ),
    },
  ]),
  actorArea('profesional', 'service_provider', [
    {
      // HU002: «Mi perfil» del profesional, con solo sus datos personales (ADR-035).
      path: 'perfil',
      loadChildren: () =>
        import('./features/identity/profile/profile.routes').then(
          (module) => module.ACCOUNT_PROFILE_ROUTES,
        ),
    },
    {
      // HU015: el profesional crea un servicio en borrador (ADR-027).
      path: 'servicios/nuevo',
      loadChildren: () =>
        import('./features/services/create-service/create-service.routes').then(
          (module) => module.CREATE_SERVICE_ROUTES,
        ),
    },
    {
      // HU019: el profesional revisa sus servicios y publica un borrador (ADR-027).
      path: 'servicios/publicacion',
      loadChildren: () =>
        import('./features/services/publish-service/publish-service.routes').then(
          (module) => module.PUBLISH_SERVICE_ROUTES,
        ),
    },
    {
      // HU010: el profesional crea, asigna y consulta planes de entrenamiento.
      path: 'entrenamientos/planes',
      loadChildren: () =>
        import('./features/training/plan-authoring/plan-authoring.routes').then(
          (module) => module.PLAN_AUTHORING_ROUTES,
        ),
    },
    {
      // HU028: el profesional publica plantillas de plan y retira las propias (ADR-041).
      path: 'entrenamientos/plantillas',
      loadChildren: () =>
        import('./features/training/templates/training-templates.routes').then(
          (module) => module.TRAINING_TEMPLATES_ROUTES,
        ),
    },
    {
      // HU014: el profesional crea, asigna y consulta planes de alimentación (ADR-037).
      path: 'alimentacion/planes',
      loadChildren: () =>
        import('./features/training/nutrition/nutrition.routes').then(
          (module) => module.NUTRITION_PLAN_AUTHORING_ROUTES,
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
    {
      // HU012: historial de salud de un deportista que autorizó al profesional (ADR-037).
      path: 'historial/salud',
      loadChildren: () =>
        import('./features/training/health/health.routes').then(
          (module) => module.PROFESSIONAL_HEALTH_HISTORY_ROUTES,
        ),
    },
    {
      // HU018: calendario integrado con la disponibilidad propia y los eventos
      // publicados (ADR-039).
      path: 'calendario',
      loadChildren: () =>
        import('./features/events/calendar/integrated-calendar.routes').then(
          (module) => module.INTEGRATED_CALENDAR_ROUTES,
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
