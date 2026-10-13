import { ApiError } from '../../../core/api/api-error';
import {
  CREATE_EVENT_ISSUES,
  CreateEventRequestDto,
  EventResponseDto,
} from '../../../core/api/bff-web/events.api';
import { zonedStartsAt } from './event-time';

/** Datos que el organizador captura (HU021). Los textos ya vienen recortados. */
export interface EventDraft {
  readonly name: string;
  readonly description: string;
  readonly discipline: string;
  readonly location: {
    readonly name: string;
    readonly address: string;
    readonly city: string;
    readonly countryCode: string;
  };
  /** Fecha y hora locales del evento (`YYYY-MM-DD`, `HH:mm`) en `timeZone`. */
  readonly startDate: string;
  readonly startTime: string;
  /** Zona IANA declarada. */
  readonly timeZone: string;
  readonly durationMinutes: number;
  readonly capacity: number;
}

/** Borrador confirmado por el backend; instantes en UTC. */
export interface CreatedEvent {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly discipline: string;
  readonly location: EventDraft['location'];
  readonly startsAt: string;
  readonly endsAt: string;
  readonly timeZone: string;
  readonly durationMinutes: number;
  readonly capacity: number;
  readonly status: 'DRAFT';
  readonly version: number;
  readonly createdAt: string;
}

/** Regla incumplida (`details[{field, issue}]`, ADR-028 decisión 9). */
export interface EventViolation {
  /** Ruta del campo (`location.country_code`); vacía si el backend no la indica. */
  readonly field: string;
  readonly issue: string;
}

/** Motivos que el cliente sabe explicar; otro motivo se muestra con un texto genérico. */
export const KNOWN_EVENT_ISSUES: readonly string[] = CREATE_EVENT_ISSUES;

/** Resultado del comando, ya traducido desde el contrato. */
export type CreateEventOutcome =
  | { readonly kind: 'created'; readonly event: CreatedEvent; readonly replayed: boolean }
  | { readonly kind: 'invalid'; readonly violations: readonly EventViolation[] }
  | { readonly kind: 'failed'; readonly error: ApiError };

/** Cuerpo exacto de ADR-028: sin `organizer_id`, estado ni fechas calculadas. */
export function toCreateEventRequest(draft: EventDraft): CreateEventRequestDto {
  return {
    name: draft.name,
    description: draft.description,
    discipline: draft.discipline,
    location: {
      name: draft.location.name,
      address: draft.location.address,
      city: draft.location.city,
      country_code: draft.location.countryCode,
    },
    starts_at: zonedStartsAt(draft.startDate, draft.startTime, draft.timeZone),
    time_zone: draft.timeZone,
    duration_minutes: draft.durationMinutes,
    capacity: draft.capacity,
  };
}

export function toCreatedEvent(dto: EventResponseDto): CreatedEvent {
  return {
    id: dto.event_id,
    name: dto.name,
    description: dto.description,
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
    createdAt: dto.created_at,
  };
}
