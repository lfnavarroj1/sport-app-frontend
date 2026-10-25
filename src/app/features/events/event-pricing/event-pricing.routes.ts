import { Routes } from '@angular/router';

import { requirePermission } from '../publish-event/require-permission.guard';
import { EventFeeEditor } from './event-fee-editor/event-fee-editor';
import { EventPricingGateway } from './event-pricing.gateway';
import { EventPricingPage } from './event-pricing-page/event-pricing-page';
import { EventPricingStore } from './event-pricing.store';
import { HttpEventPricingGateway } from './http-event-pricing.gateway';

/**
 * HU025: tarifas de los eventos propios, bajo `/organizador/eventos/tarifas`. La
 * lista es la vista maestra y `:eventId` abre el formulario a su lado (ADR-012).
 * Exige `events.pricing.manage` además del actor `organizer` (guarda del área);
 * la propiedad del evento la decide el backend (`404`).
 */
export const EVENT_PRICING_ROUTES: Routes = [
  {
    path: '',
    canActivate: [requirePermission('events.pricing.manage')],
    component: EventPricingPage,
    providers: [
      { provide: EventPricingGateway, useClass: HttpEventPricingGateway },
      EventPricingStore,
    ],
    children: [{ path: ':eventId', component: EventFeeEditor }],
  },
];
