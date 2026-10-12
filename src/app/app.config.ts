import { provideHttpClient, withFetch } from '@angular/common/http';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { APP_CONFIG, AppConfig } from './core/config/app-config';
import { provideI18n } from './core/i18n/i18n.providers';
import { HttpSessionRefresher } from './core/session/http-session-refresher';
import { SessionRefresher } from './core/session/session-refresher';

export function buildAppConfig(config: AppConfig): ApplicationConfig {
  return {
    providers: [
      provideBrowserGlobalErrorListeners(),
      provideRouter(routes),
      provideHttpClient(withFetch()),
      provideI18n(),
      { provide: APP_CONFIG, useValue: config },
      // HU003: renovación y recuperación de la sesión con la cookie del BFF web.
      { provide: SessionRefresher, useClass: HttpSessionRefresher },
    ],
  };
}
