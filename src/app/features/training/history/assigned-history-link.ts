import { Signal, computed, inject } from '@angular/core';

import { SessionAccessStore } from '../../../core/session/session-access.store';

/** Permiso del profesional para consultar historiales asignados (`actor-permissions.v1`). */
export const ASSIGNED_HISTORY_PERMISSION = 'training.history.view_assigned';

/** Historial de un deportista para el profesional (HU011): `[ruta, athleteId]`. */
export const PROFESSIONAL_HISTORY_ROUTE = '/profesional/historial/entrenamientos';

/**
 * El enlace al historial del deportista desde un plan (HU010) solo se ofrece si
 * `GET /v1/me/capabilities` confirma el permiso. Es ayuda de navegación: el BFF
 * vuelve a exigir el permiso y la autorización vigente del deportista (CA3).
 * Debe llamarse en un contexto de inyección.
 */
export function assignedHistoryAllowed(): Signal<boolean> {
  const access = inject(SessionAccessStore).view;
  return computed(() => {
    const state = access();
    return state?.status === 'success' && state.data.permissions.has(ASSIGNED_HISTORY_PERMISSION);
  });
}
