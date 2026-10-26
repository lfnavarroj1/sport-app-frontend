import { inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { CanActivateFn, Router } from '@angular/router';
import { filter, firstValueFrom } from 'rxjs';

import { SessionAccessStore } from '../../core/session/session-access.store';
import { UNAUTHORIZED_PATH } from '../../shell/navigation/navigation.registry';

/**
 * Rechaza una ruta del deportista cuando `GET /v1/me/capabilities` confirma que
 * su plan no incluye la capacidad (HU016, `planes/05-menu-lateral-por-plan.md`):
 * una URL escrita, un marcador o el botón Atrás tras bajar de plan llevan al
 * acceso no autorizado. Las capacidades solo cuentan con la suscripción `ACTIVE`,
 * como en el menú. Si la vista no se pudo confirmar, la ruta se abre y decide el
 * backend (`403 capability_required`); el control definitivo es siempre suyo.
 */
export function requireCapability(capability: string): CanActivateFn {
  return async () => {
    const access = inject(SessionAccessStore);
    const router = inject(Router);
    access.ensureLoaded();
    const view = await firstValueFrom(
      toObservable(access.view).pipe(filter((state) => state?.status !== 'loading')),
    );
    if (
      view?.status === 'success' &&
      !(view.data.subscriptionStatus === 'ACTIVE' && view.data.capabilities.has(capability))
    ) {
      return router.parseUrl(UNAUTHORIZED_PATH);
    }
    return true;
  };
}
