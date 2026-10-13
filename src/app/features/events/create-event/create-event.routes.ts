import { Routes } from '@angular/router';

import { CreateEventGateway } from './create-event.gateway';
import { CreateEventPage } from './create-event-page/create-event-page';
import { HttpCreateEventGateway } from './http-create-event.gateway';

/** HU021: crear evento en borrador, bajo `/organizador/eventos/nuevo`. */
export const CREATE_EVENT_ROUTES: Routes = [
  {
    path: '',
    component: CreateEventPage,
    providers: [{ provide: CreateEventGateway, useClass: HttpCreateEventGateway }],
  },
];
