import { inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { CanActivateFn, Router } from '@angular/router';
import { filter, firstValueFrom } from 'rxjs';

import { SessionAccessStore } from '../../../core/session/session-access.store';
import { UNAUTHORIZED_PATH } from '../../../shell/navigation/navigation.registry';

/**
 * Rechaza la ruta cuando `GET /v1/me/capabilities` confirma que el permiso falta
 * (HU024: «Publicar eventos» exige `events.publish`). Se usa después de
 * `requireActor`, que ya recuperó la sesión. Si la vista no se pudo confirmar, la
 * ruta se abre y decide el backend: un `403` se muestra sin datos. No se asume
 * el permiso ni se bloquea por un fallo transitorio; el control definitivo es
 * siempre del backend.
 */
export function requirePermission(permission: string): CanActivateFn {
  return async () => {
    const access = inject(SessionAccessStore);
    const router = inject(Router);
    access.ensureLoaded();
    const view = await firstValueFrom(
      toObservable(access.view).pipe(filter((state) => state?.status !== 'loading')),
    );
    if (view?.status === 'success' && !view.data.permissions.has(permission)) {
      return router.parseUrl(UNAUTHORIZED_PATH);
    }
    return true;
  };
}
