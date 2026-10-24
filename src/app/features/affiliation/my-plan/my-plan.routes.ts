import { Routes } from '@angular/router';

import { HttpMyPlanGateway } from './http-my-plan.gateway';
import { MyPlanGateway } from './my-plan.gateway';
import { MyPlanPage } from './my-plan-page/my-plan-page';

/** HU016: «Mi plan», bajo `/deportista/plan` (el área ya exige el actor `athlete`). */
export const MY_PLAN_ROUTES: Routes = [
  {
    path: '',
    component: MyPlanPage,
    providers: [{ provide: MyPlanGateway, useClass: HttpMyPlanGateway }],
  },
];
