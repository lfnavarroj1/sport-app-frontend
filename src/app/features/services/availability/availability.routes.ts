import { Routes } from '@angular/router';

import { AvailabilityPage } from './availability-page/availability-page';
import { AvailabilityGateway } from './availability.gateway';
import { HttpAvailabilityGateway } from './http-availability.gateway';

/**
 * HU020, deportista: disponibilidad de servicios bajo `/deportista/servicios`. La
 * ruta `/deportista/servicios/medico-deportivos` la reutiliza con
 * `data.presetCategory = 'SPORTS_MEDICINE'` (ADR-038).
 */
export const AVAILABILITY_ROUTES: Routes = [
  {
    path: '',
    component: AvailabilityPage,
    providers: [{ provide: AvailabilityGateway, useClass: HttpAvailabilityGateway }],
  },
];
