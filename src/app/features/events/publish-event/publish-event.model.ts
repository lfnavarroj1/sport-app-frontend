import { ApiError } from '../../../core/api/api-error';
import {
  EventAggregateResponseDto,
  EventDetailResponseDto,
  EventStatusDto,
} from '../../../core/api/bff-web/events.api';

/** Estado del evento (ADR-033): la única transición es `DRAFT` → `PUBLISHED`. */
export type EventStatus = EventStatusDto;

/** Evento propio del organizador, tal como lo confirma el backend; instantes en UTC. */
export interface OrganizerEvent {
  readonly id: string;
  readonly name: string;
  readonly discipline: string;
  readonly location: {
    readonly name: string;
    readonly address: string;
    readonly city: string;
    readonly countryCode: string;
  };
  readonly startsAt: string;
  readonly endsAt: string;
  /** Zona IANA declarada para el evento. */
  readonly timeZone: string;
  readonly durationMinutes: number;
  readonly capacity: number;
  readonly status: EventStatus;
  readonly version: number;
  /** `null` mientras es borrador. */
  readonly publishedAt: string | null;
}

/** Una página en el orden estable del backend (`starts_at` y `event_id` ascendentes). */
export interface OrganizerEventsPage {
  readonly events: readonly OrganizerEvent[];
  /** Cursor opaco de la página siguiente; `null` si no hay más. */
  readonly nextCursor: string | null;
}

/** Detalle de `GET /v1/events/{event_id}`: sin dirección, duración ni `published_at`. */
export interface EventDetail {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly discipline: string;
  readonly location: {
    readonly name: string;
    readonly city: string;
    readonly countryCode: string;
  };
  readonly startsAt: string;
  readonly endsAt: string;
  readonly timeZone: string;
  readonly capacity: number;
  readonly status: EventStatus;
  readonly version: number;
}

/** Requisito incumplido (`details[{field, issue}]` de un `422`, CA2). */
export interface PublishViolation {
  /** Ruta del campo (`starts_at`, `location.city`); vacía si el backend no la indica. */
  readonly field: string;
  readonly issue: string;
}

/** Resultado del comando de publicar, ya traducido desde el contrato. */
export type PublishOutcome =
  | { readonly kind: 'published'; readonly event: OrganizerEvent; readonly replayed: boolean }
  | { readonly kind: 'invalid'; readonly violations: readonly PublishViolation[] }
  | { readonly kind: 'failed'; readonly error: ApiError };

/** Filas del detalle junto a las que se muestran los requisitos faltantes. */
export type DetailRow =
  | 'name'
  | 'description'
  | 'discipline'
  | 'location'
  | 'startsAt'
  | 'endsAt'
  | 'timeZone'
  | 'capacity';

/**
 * Fila del detalle que representa el campo de un requisito incumplido; `null`
 * si no tiene una fila propia (se informa solo en el resumen). La duración se
 * marca junto al fin del evento, que es lo que el detalle muestra de ella.
 */
export function rowFor(field: string): DetailRow | null {
  if (field === 'location' || field.startsWith('location.')) {
    return 'location';
  }
  const rows: Readonly<Record<string, DetailRow>> = {
    name: 'name',
    description: 'description',
    discipline: 'discipline',
    starts_at: 'startsAt',
    ends_at: 'endsAt',
    duration_minutes: 'endsAt',
    time_zone: 'timeZone',
    capacity: 'capacity',
  };
  return rows[field] ?? null;
}

/**
 * El inicio ya pasó. Solo sirve para advertir antes de enviar: la regla
 * autoritativa (`not_in_future`) la aplica el backend (ADR-033, decisión 5).
 */
export function startsInPast(startsAt: string, now: number = Date.now()): boolean {
  return new Date(startsAt).getTime() <= now;
}

export function toOrganizerEvent(dto: EventAggregateResponseDto): OrganizerEvent {
  return {
    id: dto.event_id,
    name: dto.name,
    discipline: dto.discipline,
    location: {
      name: dto.location.name,
      address: dto.location.address,
      city: dto.location.city,
      countryCode: dto.location.country_code,
    },
    startsAt: dto.starts_at,
    endsAt: dto.ends_at,
    timeZone: dto.time_zone,
    durationMinutes: dto.duration_minutes,
    capacity: dto.capacity,
    status: dto.status,
    version: dto.version,
    publishedAt: dto.published_at,
  };
}

export function toEventDetail(dto: EventDetailResponseDto): EventDetail {
  return {
    id: dto.event_id,
    name: dto.name,
    description: dto.description,
    discipline: dto.discipline,
    location: {
      name: dto.location.name,
      city: dto.location.city,
      countryCode: dto.location.country_code,
    },
    startsAt: dto.starts_at,
    endsAt: dto.ends_at,
    timeZone: dto.time_zone,
    capacity: dto.capacity,
    status: dto.status,
    version: dto.version,
  };
}
