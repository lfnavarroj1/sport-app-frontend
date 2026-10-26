import { Routes } from '@angular/router';

import { requirePermission } from '../publish-event/require-permission.guard';
import { HttpIntegratedCalendarGateway } from './http-integrated-calendar.gateway';
import { IntegratedCalendarGateway } from './integrated-calendar.gateway';
import { IntegratedCalendarPage } from './integrated-calendar-page/integrated-calendar-page';

const PROVIDERS = [{ provide: IntegratedCalendarGateway, useClass: HttpIntegratedCalendarGateway }];

/**
 * HU018: calendario integrado del organizador y del profesional, bajo
 * `/organizador/calendario` y `/profesional/calendario` (ADR-039). Exige
 * `calendar.integrated.view` además del actor (guarda del área); el backend
 * vuelve a validarlo.
 */
export const INTEGRATED_CALENDAR_ROUTES: Routes = [
  {
    path: '',
    canActivate: [requirePermission('calendar.integrated.view')],
    component: IntegratedCalendarPage,
    providers: PROVIDERS,
  },
];

/**
 * HU018: «Calendario deportivo» del deportista, bajo `/deportista/calendario`. La
 * capacidad `calendar.sport.view` del plan se exige en `app.routes.ts`, como las
 * demás opciones del plan; el backend vuelve a validarla.
 */
export const SPORT_CALENDAR_ROUTES: Routes = [
  { path: '', component: IntegratedCalendarPage, providers: PROVIDERS },
];
