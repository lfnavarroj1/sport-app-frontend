import { Routes } from '@angular/router';

import { requirePermission } from '../../events/publish-event/require-permission.guard';
import { HttpTemplatesGateway } from './http-templates.gateway';
import { TemplatesGateway } from './templates.gateway';
import { TemplatesPage } from './templates-page/templates-page';

/**
 * HU028: plantillas de plan de entrenamiento del profesional, bajo
 * `/profesional/entrenamientos/plantillas`. Exige `training.plan.author` además
 * del actor `service_provider` (guarda del área); la propiedad de cada plantilla
 * la decide el backend (`404`).
 */
export const TRAINING_TEMPLATES_ROUTES: Routes = [
  {
    path: '',
    canActivate: [requirePermission('training.plan.author')],
    component: TemplatesPage,
    providers: [{ provide: TemplatesGateway, useClass: HttpTemplatesGateway }],
  },
];
