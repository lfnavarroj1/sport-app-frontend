import { registerLocaleData } from '@angular/common';
import localeEs from '@angular/common/locales/es';
import { LOCALE_ID, Provider } from '@angular/core';
import { provideTranslateService } from '@ngx-translate/core';
import { provideTranslateHttpLoader } from '@ngx-translate/http-loader';

/**
 * Idioma inicial. La lista de idiomas y países del MVP sigue pendiente en
 * ADR-012; agregar un idioma = nuevo archivo en `public/i18n/` + registro aquí.
 */
export const DEFAULT_LANGUAGE = 'es';

registerLocaleData(localeEs);

export function provideI18n(): Provider[] {
  return [
    provideTranslateService({
      lang: DEFAULT_LANGUAGE,
      fallbackLang: DEFAULT_LANGUAGE,
      loader: provideTranslateHttpLoader({ prefix: 'i18n/', suffix: '.json', failOnError: true }),
    }),
    { provide: LOCALE_ID, useValue: DEFAULT_LANGUAGE },
  ];
}
