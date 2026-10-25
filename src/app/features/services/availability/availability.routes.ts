import { Routes } from '@angular/router';

import { HttpServiceAssociationsGateway } from '../associations/http-service-associations.gateway';
import { ServiceAssociationsGateway } from '../associations/service-associations.gateway';
import { ServiceAssociationsStore } from '../associations/service-associations.store';
import { AvailabilityPage } from './availability-page/availability-page';
import { AvailabilityGateway } from './availability.gateway';
import { HttpAvailabilityGateway } from './http-availability.gateway';

/**
 * HU020, deportista: disponibilidad de servicios bajo `/deportista/servicios`. La
 * ruta `/deportista/servicios/medico-deportivos` la reutiliza con
 * `data.presetCategory = 'SPORTS_MEDICINE'` (ADR-038), donde la pantalla agrega las
 * asociaciones de HU017: su estado vive en la ruta y se descarta al salir.
 */
export const AVAILABILITY_ROUTES: Routes = [
  {
    path: '',
    component: AvailabilityPage,
    providers: [
      { provide: AvailabilityGateway, useClass: HttpAvailabilityGateway },
      { provide: ServiceAssociationsGateway, useClass: HttpServiceAssociationsGateway },
      ServiceAssociationsStore,
    ],
  },
];
