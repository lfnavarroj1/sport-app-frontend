import { Routes } from '@angular/router';

import { requirePermission } from '../../../events/publish-event/require-permission.guard';
import { HttpNutritionGateway } from '../http-nutrition.gateway';
import { NutritionGateway } from '../nutrition.gateway';
import { HttpRoutinesGateway } from './http-routines.gateway';
import { RoutinesGateway } from './routines.gateway';
import { RoutinesPage } from './routines-page/routines-page';

/**
 * HU030: rutinas de alimentación del profesional, bajo
 * `/profesional/alimentacion/plantillas`. Exige `nutrition.plan.author` además
 * del actor `service_provider` (guarda del área); la propiedad de cada rutina la
 * decide el backend (`404`). El catálogo de alimentos usa el adaptador de HU014.
 */
export const NUTRITION_ROUTINES_ROUTES: Routes = [
  {
    path: '',
    canActivate: [requirePermission('nutrition.plan.author')],
    component: RoutinesPage,
    providers: [
      { provide: RoutinesGateway, useClass: HttpRoutinesGateway },
      { provide: NutritionGateway, useClass: HttpNutritionGateway },
    ],
  },
];
