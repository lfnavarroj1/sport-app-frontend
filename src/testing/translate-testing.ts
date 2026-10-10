import { Provider } from '@angular/core';
import { TranslateLoader, TranslationObject, provideTranslateService } from '@ngx-translate/core';
import { Observable, of } from 'rxjs';

import es from '../../public/i18n/es.json';
import { DEFAULT_LANGUAGE } from '../app/core/i18n/i18n.providers';

class StaticTranslateLoader implements TranslateLoader {
  getTranslation(): Observable<TranslationObject> {
    return of(es);
  }
}

/** Traducciones reales para pruebas: una clave inexistente se detecta en el resultado. */
export function provideTranslateTesting(): Provider[] {
  return provideTranslateService({
    lang: DEFAULT_LANGUAGE,
    fallbackLang: DEFAULT_LANGUAGE,
    loader: () => new StaticTranslateLoader(),
  });
}
