import { Routes } from '@angular/router';

import { AccountGateway } from './account-form/account.gateway';
import { HttpAccountGateway } from './account-form/http-account.gateway';
import { HttpProfileGateway } from './http-profile.gateway';
import { PROFILE_SCOPE, ProfilePage } from './profile-page/profile-page';
import { ProfileGateway } from './profile.gateway';

/** HU002, HU005, HU006 y HU009: perfil del deportista, bajo `/deportista/perfil`. */
export const PROFILE_ROUTES: Routes = [
  {
    path: '',
    component: ProfilePage,
    providers: [
      { provide: ProfileGateway, useClass: HttpProfileGateway },
      { provide: AccountGateway, useClass: HttpAccountGateway },
    ],
  },
];

/**
 * HU002: «Mi perfil» del organizador y del profesional (`/organizador/perfil` y
 * `/profesional/perfil`), con solo sus datos personales. No consulta el perfil
 * deportivo, que es solo del deportista.
 */
export const ACCOUNT_PROFILE_ROUTES: Routes = [
  {
    path: '',
    component: ProfilePage,
    providers: [
      { provide: PROFILE_SCOPE, useValue: 'account' },
      { provide: ProfileGateway, useClass: HttpProfileGateway },
      { provide: AccountGateway, useClass: HttpAccountGateway },
    ],
  },
];
