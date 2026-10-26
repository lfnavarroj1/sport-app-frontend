import { Routes } from '@angular/router';

import { requirePermission } from '../../events/publish-event/require-permission.guard';
import { HttpRoutesGateway } from './http-routes.gateway';
import { RoutesGateway } from './routes.gateway';
import { RoutesPage } from './routes-page/routes-page';

/**
 * HU026: rutas del organizador, bajo `/organizador/rutas`. Exige
 * `training.routes.author` (`actor-permissions` v2) además del actor `organizer`
 * (guarda del área); la propiedad de cada ruta la decide el backend (`404`).
 */
export const ORGANIZER_ROUTES_ROUTES: Routes = [
  {
    path: '',
    canActivate: [requirePermission('training.routes.author')],
    component: RoutesPage,
    providers: [{ provide: RoutesGateway, useClass: HttpRoutesGateway }],
  },
];
