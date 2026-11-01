import { Routes } from '@angular/router';

import { requirePermission } from '../../events/publish-event/require-permission.guard';
import { AuthorizedAthletesGateway } from '../history/authorized-athletes/authorized-athletes.gateway';
import { HttpAuthorizedAthletesGateway } from '../history/authorized-athletes/http-authorized-athletes.gateway';
import { HealthAthletesPage } from './health-athletes-page/health-athletes-page';
import { HealthHistoryGateway } from './health-history.gateway';
import { HealthHistoryPage } from './health-history-page/health-history-page';
import { HttpHealthHistoryGateway } from './http-health-history.gateway';

const gateway = [{ provide: HealthHistoryGateway, useClass: HttpHealthHistoryGateway }];

/**
 * HU012, deportista: «Mi salud», su propio historial de molestias, incapacidades
 * o lesiones, bajo `/deportista/salud`. Opción base, sin capacidad de plan
 * (ADR-037).
 */
export const ATHLETE_HEALTH_ROUTES: Routes = [
  { path: '', component: HealthHistoryPage, providers: gateway },
];

/**
 * HU012, profesional: historial de salud de un deportista que lo autorizó, bajo
 * `/profesional/historial/salud`. Exige `health.history.view_assigned` además del
 * actor `service_provider` (guarda del área); sin `athleteId` lista los
 * deportistas autorizados. El backend decide la autorización de cada consulta.
 */
export const PROFESSIONAL_HEALTH_HISTORY_ROUTES: Routes = [
  {
    path: '',
    canActivate: [requirePermission('health.history.view_assigned')],
    providers: gateway,
    children: [
      {
        path: '',
        component: HealthAthletesPage,
        providers: [
          { provide: AuthorizedAthletesGateway, useClass: HttpAuthorizedAthletesGateway },
        ],
      },
      { path: ':athleteId', component: HealthHistoryPage },
    ],
  },
];
