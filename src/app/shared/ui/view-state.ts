import { ApiError, toApiError } from '../../core/api/api-error';

/**
 * Estado de una vista que depende de datos remotos. Conflicto, permiso
 * denegado o sin conexión se expresan mediante `error.kind`.
 */
export type ViewState<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'empty' }
  | { readonly status: 'success'; readonly data: T }
  | { readonly status: 'error'; readonly error: ApiError };

export const viewState = {
  loading: <T>(): ViewState<T> => ({ status: 'loading' }),

  /** `success` o `empty` según el criterio de vacío de la vista. */
  fromData: <T>(data: T, isEmpty: (data: T) => boolean = defaultIsEmpty): ViewState<T> =>
    isEmpty(data) ? { status: 'empty' } : { status: 'success', data },

  fromError: <T>(error: unknown): ViewState<T> => ({ status: 'error', error: toApiError(error) }),
};

function defaultIsEmpty(data: unknown): boolean {
  return data === null || data === undefined || (Array.isArray(data) && data.length === 0);
}
