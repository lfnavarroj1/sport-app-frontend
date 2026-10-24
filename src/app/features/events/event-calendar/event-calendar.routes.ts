import { Routes } from '@angular/router';

import { requirePermission } from '../publish-event/require-permission.guard';
import { EventCalendarPage } from './event-calendar-page/event-calendar-page';
import { EventCalendarGateway } from './event-calendar.gateway';
import { HttpEventCalendarGateway } from './http-event-calendar.gateway';

/**
 * HU023: calendario de eventos publicados del organizador, bajo
 * `/organizador/eventos/calendario` (ADR-040). Exige `events.calendar.view`
 * además del actor `organizer` (guarda del área); el backend vuelve a validarlo.
 */
export const EVENT_CALENDAR_ROUTES: Routes = [
  {
    path: '',
    canActivate: [requirePermission('events.calendar.view')],
    component: EventCalendarPage,
    providers: [{ provide: EventCalendarGateway, useClass: HttpEventCalendarGateway }],
  },
];
