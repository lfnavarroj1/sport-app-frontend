import { Routes } from '@angular/router';

import { PrivacyNoticePage } from './privacy-notice-page/privacy-notice-page';

/** HU001: aviso de tratamiento de datos, público. Se carga desde `app.routes.ts`. */
export const PRIVACY_NOTICE_ROUTES: Routes = [{ path: '', component: PrivacyNoticePage }];
