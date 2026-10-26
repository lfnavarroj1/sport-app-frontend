import { ApiError } from '../../../core/api/api-error';
import {
  EVENT_FEE_LIMITS,
  EventStatusDto,
  OwnEventResponseDto,
} from '../../../core/api/bff-web/events.api';

/** Tarifa informativa del evento (ADR-040): no es un cobro ni un pago. */
export interface EventFee {
  /** Cadena decimal del contrato con dos decimales (`0.00` = gratuito). */
  readonly amount: string;
  readonly currency: string;
}

/** Evento propio con su tarifa, tal como lo confirma el backend; instantes en UTC. */
export interface PricedEvent {
  readonly id: string;
  readonly name: string;
  readonly discipline: string;
  readonly city: string;
  readonly startsAt: string;
  /** Zona IANA declarada para el evento. */
  readonly timeZone: string;
  readonly status: EventStatusDto;
  readonly version: number;
  /** `null` sin tarifa. */
  readonly fee: EventFee | null;
  readonly feeUpdatedAt: string | null;
  /** Inscripciones vigentes; cada una conserva su tarifa aplicada (ADR-032). */
  readonly registrationCount: number;
}

/** Regla incumplida (`details[{field, issue}]` de un `422`, CA2). */
export interface FeeViolation {
  /** Campo del contrato (`amount`, `currency`, `starts_at`…); vacío si no se indica. */
  readonly field: string;
  readonly issue: string;
}

/** Resultado de asignar o retirar la tarifa, ya traducido desde el contrato. */
export type FeeOutcome =
  | { readonly kind: 'updated'; readonly event: PricedEvent; readonly replayed: boolean }
  | { readonly kind: 'invalid'; readonly violations: readonly FeeViolation[] }
  /** `409 version_conflict`: el evento cambió; `currentVersion` si el BFF la informa. */
  | { readonly kind: 'conflict'; readonly currentVersion: number | null }
  | { readonly kind: 'failed'; readonly error: ApiError };

/** Motivo por el que el importe escrito no se puede enviar. */
export type AmountError = 'required' | 'format' | 'tooManyDecimals' | 'outOfRange';

export type AmountParse =
  | { readonly ok: true; readonly amount: string }
  | { readonly ok: false; readonly error: AmountError };

/** Miles con punto y decimales con coma (`85.000,50`) o sin separador de miles (`85000,5`). */
const ES_CO_AMOUNT = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?$/;
/** Decimales con punto (`85000.50`), cuando no puede leerse como separador de miles. */
const DOT_DECIMAL_AMOUNT = /^(\d+)\.(\d+)$/;

/**
 * Convierte el importe escrito en `es-CO` a la cadena del contrato, con
 * exactamente dos decimales (`85.000` → `85000.00`, `0` → `0.00`). Solo aplica
 * los límites que publica el contrato (patrón y `0.00`–`99999999.99`); la regla
 * autoritativa es del backend (CA2).
 */
export function parseCopAmount(input: string): AmountParse {
  const value = input.replace(/\s/g, '');
  if (value === '') {
    return { ok: false, error: 'required' };
  }
  const match = ES_CO_AMOUNT.exec(value) ?? DOT_DECIMAL_AMOUNT.exec(value);
  if (match === null) {
    return { ok: false, error: 'format' };
  }
  const fraction = match[2] ?? '';
  if (fraction.length > 2) {
    return { ok: false, error: 'tooManyDecimals' };
  }
  const integer = match[1].replaceAll('.', '').replace(/^0+(?=\d)/, '');
  if (integer.length > EVENT_FEE_LIMITS.integerDigits) {
    return { ok: false, error: 'outOfRange' };
  }
  return { ok: true, amount: `${integer}.${fraction.padEnd(2, '0')}` };
}

/** Texto para el campo a partir de la cadena del contrato (`85000.50` → `85000,50`). */
export function amountInputValue(amount: string): string {
  const [integer, fraction] = amount.split('.');
  return fraction === '00' ? integer : `${integer},${fraction}`;
}

/** `0.00` significa evento gratuito (ADR-040). */
export function isFree(fee: EventFee | null): boolean {
  return fee !== null && Number(fee.amount) === 0;
}

/**
 * Importe en pesos colombianos con formato `es-CO`. Solo cambia la
 * presentación: el dato es el del backend.
 */
export function formatCop(amount: string, locale = 'es-CO'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(amount));
}

/**
 * El inicio ya pasó. Solo sirve para advertir antes de enviar: la regla
 * autoritativa (`event_already_started`) la aplica el backend.
 */
export function hasStarted(startsAt: string, now: number = Date.now()): boolean {
  return new Date(startsAt).getTime() <= now;
}

export function toPricedEvent(dto: OwnEventResponseDto): PricedEvent {
  return {
    id: dto.event_id,
    name: dto.name,
    discipline: dto.discipline,
    city: dto.location.city,
    startsAt: dto.starts_at,
    timeZone: dto.time_zone,
    status: dto.status,
    version: dto.version,
    fee: dto.fee === null ? null : { amount: dto.fee.amount, currency: dto.fee.currency },
    feeUpdatedAt: dto.fee_updated_at,
    registrationCount: dto.registration_count,
  };
}
