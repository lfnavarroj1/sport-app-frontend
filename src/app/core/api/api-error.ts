import { HttpErrorResponse } from '@angular/common/http';

import { ConfigValueMissingError } from '../config/app-config';
import { BffNotConfiguredError } from './bff-web-url';

/**
 * Categorías de error que la interfaz sabe representar. Se derivan del estado
 * HTTP; el significado de negocio de cada `code` lo define el contrato del BFF.
 */
export type ApiErrorKind =
  | 'offline'
  | 'validation'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'server'
  | 'not_configured'
  | 'unknown';

export interface ApiError {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  /** Código estable enviado por el BFF, si lo incluye. */
  readonly code: string | null;
  /** Permite rastrear el fallo sin exponer detalles internos. */
  readonly correlationId: string | null;
}

/**
 * Convierte cualquier fallo en un `ApiError` seguro. Nunca conserva el mensaje
 * ni el cuerpo original: la interfaz muestra textos propios de i18n.
 *
 * Lee `code` y `correlation_id` según el formato de error *propuesto* en los
 * lineamientos transversales; ajustar cuando se publique el contrato compartido.
 */
export function toApiError(error: unknown): ApiError {
  if (error instanceof BffNotConfiguredError || error instanceof ConfigValueMissingError) {
    return { kind: 'not_configured', status: null, code: null, correlationId: null };
  }
  if (!(error instanceof HttpErrorResponse)) {
    return { kind: 'unknown', status: null, code: null, correlationId: null };
  }

  const body: unknown = error.error;
  const code = readString(body, 'code');
  const correlationId = readString(body, 'correlation_id');

  return { kind: kindFromStatus(error.status), status: error.status || null, code, correlationId };
}

function kindFromStatus(status: number): ApiErrorKind {
  if (status === 0) return 'offline';
  if (status === 400 || status === 422) return 'validation';
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409 || status === 412) return 'conflict';
  if (status >= 500) return 'server';
  return 'unknown';
}

function readString(body: unknown, key: string): string | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }
  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}
