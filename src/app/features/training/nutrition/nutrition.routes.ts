import { Routes } from '@angular/router';

import { requirePermission } from '../../events/publish-event/require-permission.guard';
import { AthleteNutritionPage } from './athlete-plans/athlete-nutrition-page/athlete-nutrition-page';
import { HttpNutritionGateway } from './http-nutrition.gateway';
import { NutritionGateway } from './nutrition.gateway';
import { NutritionPlanDetailPage } from './plan-authoring/nutrition-plan-detail-page/nutrition-plan-detail-page';
import { NutritionPlanEditorPage } from './plan-authoring/nutrition-plan-editor-page/nutrition-plan-editor-page';

const gateway = [{ provide: NutritionGateway, useClass: HttpNutritionGateway }];

/**
 * HU014, profesional: crear, asignar y consultar planes de alimentación, bajo
 * `/profesional/alimentacion/planes`. Exige `nutrition.plan.author` además del
 * actor `service_provider` (guarda del área); el backend vuelve a validarlo.
 */
export const NUTRITION_PLAN_AUTHORING_ROUTES: Routes = [
  {
    path: '',
    canActivate: [requirePermission('nutrition.plan.author')],
    providers: gateway,
    children: [
      { path: '', component: NutritionPlanEditorPage },
      { path: ':planId', component: NutritionPlanDetailPage },
    ],
  },
];

/**
 * HU014, deportista: sección «Planes de alimentación» de «Mi alimentación», bajo
 * `/deportista/alimentacion`. Opción base, sin capacidad de plan (ADR-037).
 */
export const ATHLETE_NUTRITION_ROUTES: Routes = [
  { path: '', component: AthleteNutritionPage, providers: gateway },
];
