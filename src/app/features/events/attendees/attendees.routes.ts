import { Routes } from '@angular/router';

import { requirePermission } from '../publish-event/require-permission.guard';
import { AttendeesGateway } from './attendees.gateway';
import { EventAttendeesList } from './event-attendees-list/event-attendees-list';
import { EventAttendeesPage } from './event-attendees-page/event-attendees-page';
import { HttpAttendeesGateway } from './http-attendees.gateway';
import { OwnEventsStore } from './own-events.store';

/**
 * HU022: inscritos de los eventos propios, bajo `/organizador/eventos/inscritos`.
 * El selector de evento es la vista maestra y `:eventId` abre la lista a su lado
 * (ADR-012). Exige `events.attendees.view` además del actor `organizer` (guarda
 * del área); la propiedad del evento la decide el backend (`404`).
 */
export const ATTENDEES_ROUTES: Routes = [
  {
    path: '',
    canActivate: [requirePermission('events.attendees.view')],
    component: EventAttendeesPage,
    providers: [{ provide: AttendeesGateway, useClass: HttpAttendeesGateway }, OwnEventsStore],
    children: [{ path: ':eventId', component: EventAttendeesList }],
  },
];
