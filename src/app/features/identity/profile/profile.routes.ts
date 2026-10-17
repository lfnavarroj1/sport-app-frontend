import { Routes } from '@angular/router';

import { HttpProfileGateway } from './http-profile.gateway';
import { ProfilePage } from './profile-page/profile-page';
import { ProfileGateway } from './profile.gateway';

/** HU005: perfil del deportista, bajo `/deportista/perfil`. */
export const PROFILE_ROUTES: Routes = [
  {
    path: '',
    component: ProfilePage,
    providers: [{ provide: ProfileGateway, useClass: HttpProfileGateway }],
  },
];
