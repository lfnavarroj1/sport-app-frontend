import { Routes } from '@angular/router';

import { HistoryPage } from './history-page/history-page';
import { HistoryGateway } from './history.gateway';
import { HttpHistoryGateway } from './http-history.gateway';
import { ProfessionalHistoryIntro } from './professional-history-intro/professional-history-intro';

const gateway = [{ provide: HistoryGateway, useClass: HttpHistoryGateway }];

/** HU011, deportista: su propio historial, bajo `/deportista/historial/entrenamientos`. */
export const ATHLETE_HISTORY_ROUTES: Routes = [
  { path: '', component: HistoryPage, providers: gateway },
];

/**
 * HU011, profesional: historial de un deportista que lo autorizó, bajo
 * `/profesional/historial/entrenamientos/:athleteId`. Sin `athleteId`, la entrada
 * explica cómo llegar desde un plan (HU010).
 */
export const PROFESSIONAL_HISTORY_ROUTES: Routes = [
  {
    path: '',
    providers: gateway,
    children: [
      { path: '', component: ProfessionalHistoryIntro },
      {
        path: ':athleteId',
        component: HistoryPage,
        data: { planRoute: '/profesional/entrenamientos/planes' },
      },
    ],
  },
];
