import { HttpErrorResponse } from '@angular/common/http';

import { toApiError } from './api-error';
import { BffNotConfiguredError } from './bff-web-url';

describe('toApiError', () => {
  function httpError(status: number, error: unknown = null): HttpErrorResponse {
    return new HttpErrorResponse({ status, error });
  }

  it('clasifica los estados HTTP en categorías de interfaz', () => {
    expect(toApiError(httpError(0)).kind).toBe('offline');
    expect(toApiError(httpError(400)).kind).toBe('validation');
    expect(toApiError(httpError(422)).kind).toBe('validation');
    expect(toApiError(httpError(401)).kind).toBe('unauthenticated');
    expect(toApiError(httpError(403)).kind).toBe('forbidden');
    expect(toApiError(httpError(404)).kind).toBe('not_found');
    expect(toApiError(httpError(409)).kind).toBe('conflict');
    expect(toApiError(httpError(412)).kind).toBe('conflict');
    expect(toApiError(httpError(503)).kind).toBe('server');
    expect(toApiError(httpError(418)).kind).toBe('unknown');
  });

  it('conserva solo el código estable y el identificador de correlación', () => {
    const error = toApiError(
      httpError(409, {
        code: 'version_conflict',
        message: 'detalle que no debe mostrarse',
        correlation_id: 'c0ffee00-0000-4000-8000-000000000000',
      }),
    );

    expect(error).toEqual({
      kind: 'conflict',
      status: 409,
      code: 'version_conflict',
      correlationId: 'c0ffee00-0000-4000-8000-000000000000',
    });
  });

  it('no interpreta un error desconocido como éxito', () => {
    expect(toApiError(new Error('fallo inesperado')).kind).toBe('unknown');
    expect(toApiError('texto').kind).toBe('unknown');
  });

  it('identifica la falta de configuración del BFF', () => {
    expect(toApiError(new BffNotConfiguredError()).kind).toBe('not_configured');
  });
});
