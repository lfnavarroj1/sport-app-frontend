import { Routes } from '@angular/router';

import { HttpPlanAuthoringGateway } from './http-plan-authoring.gateway';
import { PlanAuthoringGateway } from './plan-authoring.gateway';
import { PlanDetailPage } from './plan-detail-page/plan-detail-page';
import { PlanEditorPage } from './plan-editor-page/plan-editor-page';

/**
 * HU010, profesional: crear y asignar planes y consultarlos. Se carga de forma
 * diferida bajo `/profesional/entrenamientos/planes` desde `app.routes.ts`.
 */
export const PLAN_AUTHORING_ROUTES: Routes = [
  {
    path: '',
    providers: [{ provide: PlanAuthoringGateway, useClass: HttpPlanAuthoringGateway }],
    children: [
      { path: '', component: PlanEditorPage },
      { path: ':planId', component: PlanDetailPage },
    ],
  },
];
