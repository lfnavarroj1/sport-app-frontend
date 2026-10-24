import {
  ConflictReasonDto,
  EventConflictsResponseDto,
  PublishedEventItemDto,
} from '../../../core/api/bff-web/events.api';

/** Evento publicado del calendario (HU023 CA1): sin organizador ni dirección. */
export interface CalendarEvent {
  readonly id: string;
  readonly name: string;
  readonly discipline: string;
  readonly location: {
    readonly name: string;
    readonly city: string;
    readonly countryCode: string;
  };
  /** Instantes ISO 8601 en UTC. */
  readonly startsAt: string;
  readonly endsAt: string;
  /** Zona IANA del evento, visible junto a la hora del navegador (CA4). */
  readonly timeZone: string;
}

/** Una página en el orden estable del backend (`starts_at` y `event_id` ascendentes). */
export interface CalendarPage {
  readonly events: readonly CalendarEvent[];
  /** Cursor opaco de la página siguiente; `null` si no hay más. */
  readonly nextCursor: string | null;
}

export type ConflictReason = ConflictReasonDto;

/** Evento publicado que coincide con el evento propio elegido (CA2). */
export interface EventConflict {
  readonly id: string;
  readonly name: string;
  readonly discipline: string;
  readonly city: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly timeZone: string;
  /** Uno o ambos, en el orden del contrato. */
  readonly reasons: readonly ConflictReason[];
}

export interface EventConflicts {
  readonly conflicts: readonly EventConflict[];
  /** Instante de la evaluación en el BFF. */
  readonly evaluatedAt: string;
}

/** Periodo de la consulta: instantes ISO 8601 en UTC (`[from, to)`). */
export interface CalendarPeriod {
  readonly from: string;
  readonly to: string;
}

/** Consulta del calendario: periodo y filtros opcionales (ya recortados). */
export interface CalendarQuery {
  readonly period: CalendarPeriod;
  readonly discipline: string | null;
  readonly city: string | null;
}

/** Regla incumplida que informa el backend (`422 validation_error`, CA3). */
export interface CalendarViolation {
  /** Parámetro sin el prefijo `query.` (`to`, `city`); vacío si no se indica. */
  readonly field: string;
  readonly issue: string;
}

/** Periodo máximo de la consulta (ADR-040), el mismo que valida el backend. */
export const MAX_PERIOD_DAYS = 92;
const DAY_MS = 86_400_000;

export function toCalendarEvent(dto: PublishedEventItemDto): CalendarEvent {
  return {
    id: dto.event_id,
    name: dto.name,
    discipline: dto.discipline,
    location: {
      name: dto.location.name,
      city: dto.location.city,
      countryCode: dto.location.country_code,
    },
    startsAt: dto.starts_at,
    endsAt: dto.ends_at,
    timeZone: dto.time_zone,
  };
}

export function toEventConflicts(dto: EventConflictsResponseDto): EventConflicts {
  return {
    conflicts: dto.conflicts.map((item) => ({
      id: item.event_id,
      name: item.name,
      discipline: item.discipline,
      city: item.city,
      startsAt: item.starts_at,
      endsAt: item.ends_at,
      timeZone: item.time_zone,
      reasons: [...item.reasons],
    })),
    evaluatedAt: dto.evaluated_at,
  };
}

/** Instante en UTC sin milisegundos: `2027-03-01T05:00:00Z`. */
export function toUtcIso(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Mes `month` (0–11) de `year` en la zona del navegador: desde la medianoche del
 * día 1 hasta la del día 1 del mes siguiente.
 */
export function monthPeriod(year: number, month: number): CalendarPeriod {
  return {
    from: toUtcIso(new Date(year, month, 1)),
    to: toUtcIso(new Date(year, month + 1, 1)),
  };
}

/** Fecha local `YYYY-MM-DD` a medianoche en la zona del navegador. */
function localMidnight(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Días `from`–`to` (`YYYY-MM-DD`, ambos incluidos) en la zona del navegador: la
 * consulta va hasta la medianoche del día siguiente a `to`.
 */
export function daysPeriod(from: string, to: string): CalendarPeriod {
  const end = localMidnight(to);
  end.setDate(end.getDate() + 1);
  return { from: toUtcIso(localMidnight(from)), to: toUtcIso(end) };
}

/**
 * Validación de experiencia del periodo, con la misma regla que el backend
 * (ADR-040): el fin no puede ser anterior al inicio ni el periodo superar 92
 * días. Devuelve el motivo con los nombres del contrato o `null`.
 */
export function periodIssue(
  from: string,
  to: string,
): 'ends_before_starts' | 'out_of_range' | null {
  const period = daysPeriod(from, to);
  const span = Date.parse(period.to) - Date.parse(period.from);
  if (span <= 0) {
    return 'ends_before_starts';
  }
  return span > MAX_PERIOD_DAYS * DAY_MS ? 'out_of_range' : null;
}

/** Día del calendario en la zona del navegador: `YYYY-MM-DD`. */
export function localDayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export interface MonthDay {
  /** `YYYY-MM-DD` en la zona del navegador. */
  readonly key: string;
  readonly day: number;
  readonly inMonth: boolean;
  /** Eventos que empiezan ese día en la zona del navegador, en el orden recibido. */
  readonly events: readonly CalendarEvent[];
}

/**
 * Semanas del mes (lunes a domingo) con los eventos ubicados por el día de inicio
 * en la zona del navegador. Los días de los meses vecinos completan las semanas
 * sin eventos.
 */
export function monthWeeks(
  year: number,
  month: number,
  events: readonly CalendarEvent[],
): readonly (readonly MonthDay[])[] {
  const byDay = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const key = localDayKey(new Date(event.startsAt));
    byDay.set(key, [...(byDay.get(key) ?? []), event]);
  }
  const first = new Date(year, month, 1);
  // getDay(): 0 = domingo. La semana empieza el lunes.
  const start = new Date(year, month, 1 - ((first.getDay() + 6) % 7));
  const weeks: MonthDay[][] = [];
  const cursor = new Date(start);
  do {
    const week: MonthDay[] = [];
    for (let i = 0; i < 7; i++) {
      const key = localDayKey(cursor);
      const inMonth = cursor.getMonth() === month;
      week.push({
        key,
        day: cursor.getDate(),
        inMonth,
        events: inMonth ? (byDay.get(key) ?? []) : [],
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  } while (cursor.getMonth() === month);
  return weeks;
}
