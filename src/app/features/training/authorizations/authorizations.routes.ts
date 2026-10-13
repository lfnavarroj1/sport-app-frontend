import { Routes } from '@angular/router';

import { AthleteAuthorizationsPage } from './athlete-authorizations-page/athlete-authorizations-page';
import { AuthorizationsGateway } from './authorizations.gateway';
import { HttpAuthorizationsGateway } from './http-authorizations.gateway';

/**
 * HU010, deportista: autorizar o revocar a profesionales. Se carga de forma
 * diferida bajo `/deportista/entrenamientos/planes` desde `app.routes.ts`.
 */
export const AUTHORIZATIONS_ROUTES: Routes = [
  {
    path: '',
    component: AthleteAuthorizationsPage,
    providers: [{ provide: AuthorizationsGateway, useClass: HttpAuthorizationsGateway }],
  },
];
