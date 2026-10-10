import { HttpErrorResponse } from '@angular/common/http';

import { viewState } from './view-state';

describe('viewState', () => {
  it('crea el estado de carga', () => {
    expect(viewState.loading()).toEqual({ status: 'loading' });
  });

  it('distingue datos presentes de vacíos', () => {
    expect(viewState.fromData([1])).toEqual({ status: 'success', data: [1] });
    expect(viewState.fromData([])).toEqual({ status: 'empty' });
    expect(viewState.fromData(null)).toEqual({ status: 'empty' });
  });

  it('acepta un criterio de vacío propio de la vista', () => {
    const page = { items: [] as number[], total: 0 };

    expect(viewState.fromData(page, (p) => p.total === 0)).toEqual({ status: 'empty' });
  });

  it('convierte un fallo en un error seguro', () => {
    const state = viewState.fromError(new HttpErrorResponse({ status: 403 }));

    expect(state.status).toBe('error');
    expect(state.status === 'error' && state.error.kind).toBe('forbidden');
  });
});
