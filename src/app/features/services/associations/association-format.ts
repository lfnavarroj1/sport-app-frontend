import { ApiError } from '../../../core/api/api-error';
import {
  ASSOCIATE_SERVICE_ERROR_CODES,
  DISSOCIATE_SERVICE_ERROR_CODES,
} from '../../../core/api/bff-web/service-associations.api';
import { browserTimeZone } from '../availability/availability-format';

/** Ruta de «Mi plan», donde el deportista compara los planes (HU016). */
export const COMPARE_PLANS_ROUTE = '/deportista/plan';

const MESSAGE_BY_CODE: Readonly<Record<string, string>> = {
  [ASSOCIATE_SERVICE_ERROR_CODES.serviceNotFound]: 'services.associations.errors.serviceNotFound',
  [ASSOCIATE_SERVICE_ERROR_CODES.idempotencyKeyReused]:
    'services.associations.errors.idempotencyKeyReused',
  [DISSOCIATE_SERVICE_ERROR_CODES.associationNotFound]:
    'services.associations.errors.associationNotFound',
};

/** El plan del deportista ya no incluye la capacidad: se explica con «Comparar planes». */
export function isCapabilityRequired(error: ApiError): boolean {
  return error.code === ASSOCIATE_SERVICE_ERROR_CODES.capabilityRequired;
}

/** Clave i18n de un fallo: el código estable si tiene mensaje propio y, si no, su categoría. */
export function failureMessageKey(error: ApiError): string {
  return (error.code && MESSAGE_BY_CODE[error.code]) || `common.errors.${error.kind}`;
}

/** Fecha y hora de un instante UTC en la zona del navegador. */
export function formatInstant(
  instant: string,
  locale: string,
  timeZone: string = browserTimeZone(),
): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(instant));
}
