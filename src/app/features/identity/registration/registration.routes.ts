import { Routes } from '@angular/router';

import { HttpRegistrationGateway } from './http-registration.gateway';
import { RegistrationGateway } from './registration.gateway';
import { RegistrationPage } from './registration-page/registration-page';

/** HU001: registro de usuario. Se carga de forma diferida desde `app.routes.ts`. */
export const REGISTRATION_ROUTES: Routes = [
  {
    path: '',
    component: RegistrationPage,
    providers: [{ provide: RegistrationGateway, useClass: HttpRegistrationGateway }],
  },
];
