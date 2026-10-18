import { Routes } from '@angular/router';

import { AuthorizedAthletesPage } from './authorized-athletes/authorized-athletes-page/authorized-athletes-page';
import { AuthorizedAthletesGateway } from './authorized-athletes/authorized-athletes.gateway';
import { HttpAuthorizedAthletesGateway } from './authorized-athletes/http-authorized-athletes.gateway';
import { HistoryPage } from './history-page/history-page';
import { HistoryGateway } from './history.gateway';
import { HttpHistoryGateway } from './http-history.gateway';

const gateway = [{ provide: HistoryGateway, useClass: HttpHistoryGateway }];

/** HU011, deportista: su propio historial, bajo `/deportista/historial/entrenamientos`. */
export const ATHLETE_HISTORY_ROUTES: Routes = [
  { path: '', component: HistoryPage, providers: gateway },
];

/**
 * HU011, profesional: historial de un deportista que lo autorizó, bajo
 * `/profesional/historial/entrenamientos/:athleteId`. Sin `athleteId`, la entrada
 * lista los deportistas que lo autorizaron para elegir uno (CA5); el acceso desde
 * un plan de HU010 se conserva como atajo.
 */
export const PROFESSIONAL_HISTORY_ROUTES: Routes = [
  {
    path: '',
    providers: gateway,
    children: [
      {
        path: '',
        component: AuthorizedAthletesPage,
        providers: [
          { provide: AuthorizedAthletesGateway, useClass: HttpAuthorizedAthletesGateway },
        ],
      },
      {
        path: ':athleteId',
        component: HistoryPage,
        data: { planRoute: '/profesional/entrenamientos/planes' },
      },
    ],
  },
];
