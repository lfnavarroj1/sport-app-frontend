import { Routes } from '@angular/router';

import { requirePermission } from '../../events/publish-event/require-permission.guard';
import { HttpPublishServiceGateway } from './http-publish-service.gateway';
import { PublishServiceGateway } from './publish-service.gateway';
import { PublishServicesPage } from './publish-services-page/publish-services-page';
import { ServicePublicationsStore } from './service-publications.store';
import { ServicePublishDetail } from './service-publish-detail/service-publish-detail';

/**
 * HU019: publicar servicios, bajo `/profesional/servicios/publicacion`. La lista
 * es la vista maestra y `:serviceId` abre el detalle a su lado (ADR-012). Exige
 * `services.publish` además del actor `service_provider` (guarda del área).
 */
export const PUBLISH_SERVICE_ROUTES: Routes = [
  {
    path: '',
    canActivate: [requirePermission('services.publish')],
    component: PublishServicesPage,
    providers: [
      { provide: PublishServiceGateway, useClass: HttpPublishServiceGateway },
      ServicePublicationsStore,
    ],
    children: [{ path: ':serviceId', component: ServicePublishDetail }],
  },
];
