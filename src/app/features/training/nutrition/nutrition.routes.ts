import { Routes } from '@angular/router';

import { requirePermission } from '../../events/publish-event/require-permission.guard';
import { AuthorizedAthletesGateway } from '../history/authorized-athletes/authorized-athletes.gateway';
import { HttpAuthorizedAthletesGateway } from '../history/authorized-athletes/http-authorized-athletes.gateway';
import { AthleteNutritionPage } from './athlete-plans/athlete-nutrition-page/athlete-nutrition-page';
import { FoodIntakesGateway } from './intake-history/food-intakes.gateway';
import { HttpFoodIntakesGateway } from './intake-history/http-food-intakes.gateway';
import { AthleteFoodIntakesPage } from './intake-history/professional/athlete-food-intakes-page/athlete-food-intakes-page';
import { NutritionAthletesPage } from './intake-history/professional/nutrition-athletes-page/nutrition-athletes-page';
import { HttpNutritionGateway } from './http-nutrition.gateway';
import { NutritionGateway } from './nutrition.gateway';
import { NutritionPlanDetailPage } from './plan-authoring/nutrition-plan-detail-page/nutrition-plan-detail-page';
import { NutritionPlanEditorPage } from './plan-authoring/nutrition-plan-editor-page/nutrition-plan-editor-page';

const gateway = [{ provide: NutritionGateway, useClass: HttpNutritionGateway }];
const intakesGateway = { provide: FoodIntakesGateway, useClass: HttpFoodIntakesGateway };

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
 * «Mi alimentación» del deportista, bajo `/deportista/alimentacion`: sección
 * «Planes de alimentación» (HU014) y «Mis consumos» (HU013). Opción base, sin
 * capacidad de plan (ADR-037).
 */
export const ATHLETE_NUTRITION_ROUTES: Routes = [
  { path: '', component: AthleteNutritionPage, providers: [...gateway, intakesGateway] },
];

/**
 * HU013, profesional: historial de alimentación de los deportistas que lo
 * autorizaron, bajo `/profesional/historial/alimentacion`. Exige
 * `nutrition.history.view_assigned` además del actor `service_provider`; sin
 * `athleteId` lista los deportistas autorizados (`GET /v1/me/training-athletes`).
 * El backend decide la autorización de cada consulta (CA3).
 */
export const PROFESSIONAL_NUTRITION_HISTORY_ROUTES: Routes = [
  {
    path: '',
    canActivate: [requirePermission('nutrition.history.view_assigned')],
    providers: [...gateway, intakesGateway],
    children: [
      {
        path: '',
        component: NutritionAthletesPage,
        providers: [
          { provide: AuthorizedAthletesGateway, useClass: HttpAuthorizedAthletesGateway },
        ],
      },
      { path: ':athleteId', component: AthleteFoodIntakesPage },
    ],
  },
];
