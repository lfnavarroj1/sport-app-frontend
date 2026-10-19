import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

import { PROFILE_DECIMAL_PATTERN } from '../../../core/api/bff-web/profile.api';
import { decimalTenths, localDateTimeToUtc, normalizeDecimal } from './profile.model';

/**
 * Validaciones de experiencia de HU005: solo las restricciones por campo del
 * contrato (ADR-034). Las reglas entre campos o relativas al reloj del servidor
 * (edad, sistólica > diastólica, ventana de `measured_at`) las decide el backend.
 */

/**
 * Longitud tras recortar los espacios exteriores, como la mide el backend. Usa
 * los mismos errores que `Validators.minLength`/`maxLength`. Con `optional`, un
 * texto vacío es válido (se envía `null`).
 */
export function trimmedLength(min: number, max: number, optional = false): ValidatorFn {
  return (control: AbstractControl<string>): ValidationErrors | null => {
    const value = (control.value ?? '').trim();
    if (value === '') {
      return optional ? null : { required: true };
    }
    if (value.length < min) {
      return { minlength: { requiredLength: min, actualLength: value.length } };
    }
    if (value.length > max) {
      return { maxlength: { requiredLength: max, actualLength: value.length } };
    }
    return null;
  };
}

/** Entero (los `<input type="number">` admiten decimales). */
export const integer = (control: AbstractControl<number | null>): ValidationErrors | null =>
  control.value !== null && !Number.isInteger(control.value) ? { integer: true } : null;

/**
 * Decimal capturado como texto, con coma o punto y un decimal como máximo, en
 * el rango `[min, max]` del contrato (comparado en décimas, sin `Number`).
 * `display` da el texto de los límites para el mensaje (con el separador del idioma).
 */
export function decimalInRange(
  min: string,
  max: string,
  options: { readonly optional: boolean; readonly display: (value: string) => string },
): ValidatorFn {
  const minTenths = decimalTenths(min) ?? 0;
  const maxTenths = decimalTenths(max) ?? 0;
  return (control: AbstractControl<string>): ValidationErrors | null => {
    const value = normalizeDecimal(control.value ?? '');
    if (value === '') {
      return options.optional ? null : { required: true };
    }
    const tenths = PROFILE_DECIMAL_PATTERN.test(value) ? decimalTenths(value) : null;
    if (tenths === null) {
      return { decimal: true };
    }
    if (tenths < minTenths || tenths > maxTenths) {
      return { decimalRange: { min: options.display(min), max: options.display(max) } };
    }
    return null;
  };
}

/**
 * La presión arterial es un objeto con ambos valores obligatorios: si el
 * hermano tiene valor, este también debe tenerlo.
 */
export function pairedWith(sibling: string): ValidatorFn {
  return (control: AbstractControl<number | null>): ValidationErrors | null => {
    const other = control.parent?.get(sibling)?.value as number | null | undefined;
    return control.value === null && other !== null && other !== undefined
      ? { bloodPressurePair: true }
      : null;
  };
}

/** Fecha y hora locales (`YYYY-MM-DDTHH:mm`) convertibles a `measured_at`. */
export const localDateTime = (control: AbstractControl<string>): ValidationErrors | null =>
  control.value && localDateTimeToUtc(control.value) === null ? { dateTime: true } : null;
