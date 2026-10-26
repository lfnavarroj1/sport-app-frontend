import {
  AttendeeStatusFilterDto,
  EventAttendeesResponseDto,
} from '../../../core/api/bff-web/events.api';

/**
 * Modelo de pantalla de los inscritos de un evento (HU022, ADR-039). Transforma
 * el transporte de `GET /v1/me/events/{event_id}/registrations` sin reglas del
 * dominio: propiedad, filtro, orden y conteos los decide el backend.
 */

export type AttendeeFilter = AttendeeStatusFilterDto;

/** Estados de inscripción con texto propio; otro estado se muestra con su código. */
export const KNOWN_ATTENDEE_STATUSES: readonly string[] = ['REGISTERED'];

/** Inscripción con identidad mínima: nombre, estado, fecha y tarifa aplicada. */
export interface Attendee {
  readonly registrationId: string;
  /** `null` si Usuarios no entregó el nombre. */
  readonly displayName: string | null;
  readonly status: string;
  /** Instante UTC (`Z`). */
  readonly registeredAt: string;
  /** Informativa: no es un cobro. `null` si el evento no tenía tarifa. */
  readonly appliedFee: { readonly amount: string; readonly currency: string } | null;
}

/** Una página en el orden del backend (`registered_at` y `registration_id` ascendentes). */
export interface AttendeesPage {
  readonly attendees: readonly Attendee[];
  /** Inscripciones que cumplen el filtro. */
  readonly total: number;
  /** Todas las inscripciones del evento por estado, en el orden del backend. */
  readonly byStatus: readonly { readonly status: string; readonly count: number }[];
  /** Cursor opaco de la página siguiente; `null` si no hay más. */
  readonly nextCursor: string | null;
  /** `false` si `sources[users]` llegó `UNAVAILABLE` (CA6). */
  readonly namesAvailable: boolean;
}

export function toAttendeesPage(dto: EventAttendeesResponseDto): AttendeesPage {
  return {
    attendees: dto.items.map((item) => ({
      registrationId: item.registration_id,
      displayName: item.display_name,
      status: item.status,
      registeredAt: item.registered_at,
      appliedFee: item.applied_fee,
    })),
    total: dto.total,
    byStatus: Object.entries(dto.by_status).map(([status, count]) => ({ status, count })),
    nextCursor: dto.next_cursor,
    namesAvailable: !dto.sources.some(
      (source) => source.source === 'users' && source.status === 'UNAVAILABLE',
    ),
  };
}

/**
 * Tarifa aplicada en la moneda que informa el backend, de 0 a 2 decimales, desde
 * la cadena decimal del contrato. Una moneda que `Intl` no conoce se muestra con
 * su código.
 */
export function formatFee(amount: string, currency: string, locale = 'es-CO'): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(Number(amount));
  } catch {
    return `${amount} ${currency}`;
  }
}
