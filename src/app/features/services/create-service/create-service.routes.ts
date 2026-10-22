import { Routes } from '@angular/router';

import { CreateServiceGateway } from './create-service.gateway';
import { CreateServicePage } from './create-service-page/create-service-page';
import { HttpCreateServiceGateway } from './http-create-service.gateway';

/** HU015: crear servicio en borrador, bajo `/profesional/servicios/nuevo`. */
export const CREATE_SERVICE_ROUTES: Routes = [
  {
    path: '',
    component: CreateServicePage,
    providers: [{ provide: CreateServiceGateway, useClass: HttpCreateServiceGateway }],
  },
];
