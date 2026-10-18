import { Routes } from '@angular/router';

import { EventPublishDetail } from './event-publish-detail/event-publish-detail';
import { HttpPublishEventGateway } from './http-publish-event.gateway';
import { PublishEventGateway } from './publish-event.gateway';
import { PublishEventsPage } from './publish-events-page/publish-events-page';
import { PublishedEventsStore } from './published-events.store';
import { requirePermission } from './require-permission.guard';

/**
 * HU024: publicar eventos, bajo `/organizador/eventos/publicacion`. La lista es
 * la vista maestra y `:eventId` abre el detalle a su lado (ADR-012). Exige
 * `events.publish` además del actor `organizer` (guarda del área).
 */
export const PUBLISH_EVENT_ROUTES: Routes = [
  {
    path: '',
    canActivate: [requirePermission('events.publish')],
    component: PublishEventsPage,
    providers: [
      { provide: PublishEventGateway, useClass: HttpPublishEventGateway },
      PublishedEventsStore,
    ],
    children: [{ path: ':eventId', component: EventPublishDetail }],
  },
];
