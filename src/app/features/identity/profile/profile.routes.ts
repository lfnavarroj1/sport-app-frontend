import { Routes } from '@angular/router';

import { AccountStatementGateway } from '../../affiliation/account-statement/account-statement.gateway';
import { HttpAccountStatementGateway } from '../../affiliation/account-statement/http-account-statement.gateway';
import { AccountGateway } from './account-form/account.gateway';
import { HttpAccountGateway } from './account-form/http-account.gateway';
import { HttpProfileGateway } from './http-profile.gateway';
import { PROFILE_SCOPE, ProfilePage } from './profile-page/profile-page';
import { ProfileGateway } from './profile.gateway';

/**
 * HU002, HU005, HU006, HU007 y HU009: perfil del deportista, bajo
 * `/deportista/perfil`, con su estado de cuenta (HU007).
 */
export const PROFILE_ROUTES: Routes = [
  {
    path: '',
    component: ProfilePage,
    providers: [
      { provide: ProfileGateway, useClass: HttpProfileGateway },
      { provide: AccountGateway, useClass: HttpAccountGateway },
      { provide: AccountStatementGateway, useClass: HttpAccountStatementGateway },
    ],
  },
];

/**
 * HU002 y HU007: «Mi perfil» del organizador y del profesional
 * (`/organizador/perfil` y `/profesional/perfil`), con sus datos personales y su
 * estado de cuenta. No consulta el perfil deportivo, que es solo del deportista.
 */
export const ACCOUNT_PROFILE_ROUTES: Routes = [
  {
    path: '',
    component: ProfilePage,
    providers: [
      { provide: PROFILE_SCOPE, useValue: 'account' },
      { provide: ProfileGateway, useClass: HttpProfileGateway },
      { provide: AccountGateway, useClass: HttpAccountGateway },
      { provide: AccountStatementGateway, useClass: HttpAccountStatementGateway },
    ],
  },
];
