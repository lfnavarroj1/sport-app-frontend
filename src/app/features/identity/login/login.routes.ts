import { Routes } from '@angular/router';

import { LoginPage } from './login-page/login-page';

/** HU003 (esqueleto): inicio de sesión. Se carga de forma diferida desde `app.routes.ts`. */
export const LOGIN_ROUTES: Routes = [{ path: '', component: LoginPage }];
