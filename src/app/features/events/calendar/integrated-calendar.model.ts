import {
  IntegratedCalendarItemDto,
  IntegratedCalendarResponseDto,
  IntegratedCalendarSourceDto,
  IntegratedItemStatusDto,
  IntegratedSourceStatusDto,
} from '../../../core/api/bff-web/integrated-calendar.api';
import { localDayKey } from '../event-calendar/event-calendar.model';

export type CalendarSource = IntegratedCalendarSourceDto;
export type CalendarItemStatus = IntegratedItemStatusDto;

/** Lo que se presenta de cada elemento según su dominio (sin unir datos de otros). */
export type CalendarItemDetail =
  | {
      readonly kind: 'event';
      readonly sport: string;
      readonly location: CalendarLocation;
    }
  | { readonly kind: 'registration'; readonly location: CalendarLocation }
  | {
      readonly kind: 'session';
      readonly sport: string;
      readonly durationMinutes: number;
      readonly rpe: number;
    }
  | {
      readonly kind: 'service';
      readonly category: string;
      readonly modality: string;
      readonly capacity: number;
    };

export interface CalendarLocation {
  readonly name: string;
  readonly city: string;
  readonly countryCode: string;
}

/** Un elemento del calendario integrado (HU018 CA1). */
export interface CalendarItem {
  /** `item_id` del BFF, único en la respuesta. */
  readonly id: string;
  readonly source: CalendarSource;
  readonly status: CalendarItemStatus;
  readonly title: string;
  /**
   * Día en que se muestra, en la zona del navegador (CA3): el del instante de
   * inicio o, para una sesión sin hora, su fecha (`occurs_on`).
   */
  readonly day: string;
  /** Instantes ISO 8601 en UTC; `null` en una sesión sin hora. */
  readonly startsAt: string | null;
  readonly endsAt: string | null;
  /** Zona IANA declarada por el dominio; `null` en una sesión sin hora. */
  readonly timeZone: string | null;
  readonly detail: CalendarItemDetail;
  /** Identificadores del dominio propietario (`reference`), tal como llegan. */
  readonly reference: Readonly<Record<string, string>>;
}

export interface CalendarSourceState {
  readonly name: CalendarSource;
  readonly status: IntegratedSourceStatusDto;
  /** La fuente tenía más de 200 elementos y solo llegaron los primeros (CA6). */
  readonly truncated: boolean;
}

export interface IntegratedCalendar {
  /** Elementos en orden cronológico en la zona del navegador. */
  readonly items: readonly CalendarItem[];
  /** Fuentes del actor; una distinta de `OK` está incompleta (CA5). */
  readonly sources: readonly CalendarSourceState[];
  readonly evaluatedAt: string;
}

export function toIntegratedCalendar(dto: IntegratedCalendarResponseDto): IntegratedCalendar {
  return {
    items: chronological(dto.items.map(toCalendarItem)),
    sources: dto.sources.map((source) => ({ ...source })),
    evaluatedAt: dto.evaluated_at,
  };
}

export function toCalendarItem(dto: IntegratedCalendarItemDto): CalendarItem {
  return {
    id: dto.item_id,
    source: dto.source,
    status: dto.status,
    title: dto.title,
    day: dto.starts_at !== null ? localDayKey(new Date(dto.starts_at)) : dto.occurs_on,
    startsAt: dto.starts_at,
    endsAt: dto.ends_at,
    timeZone: dto.time_zone,
    detail: detailOf(dto),
    reference: { ...dto.reference },
  };
}

function detailOf(dto: IntegratedCalendarItemDto): CalendarItemDetail {
  switch (dto.source) {
    case 'OWN_EVENT':
    case 'EVENT_PUBLISHED':
      return { kind: 'event', sport: dto.sport, location: toLocation(dto.location) };
    case 'EVENT_REGISTRATION':
      return { kind: 'registration', location: toLocation(dto.location) };
    case 'TRAINING_PLAN_SESSION':
      return {
        kind: 'session',
        sport: dto.sport,
        durationMinutes: dto.duration_minutes,
        rpe: dto.rpe,
      };
    case 'OWN_SERVICE_AVAILABILITY':
    case 'ASSOCIATED_SERVICE_AVAILABILITY':
      return {
        kind: 'service',
        category: dto.category,
        modality: dto.modality,
        capacity: dto.capacity,
      };
  }
}

function toLocation(location: {
  name: string;
  city: string;
  country_code: string;
}): CalendarLocation {
  return { name: location.name, city: location.city, countryCode: location.country_code };
}

/**
 * Orden cronológico en la zona del navegador: por día y, dentro del día, primero
 * lo que no tiene hora y luego por instante. Ante empate se conserva el orden del
 * BFF (`source`, `item_id`), que es estable.
 */
function chronological(items: readonly CalendarItem[]): CalendarItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        a.item.day.localeCompare(b.item.day) ||
        startOf(a.item) - startOf(b.item) ||
        a.index - b.index,
    )
    .map(({ item }) => item);
}

function startOf(item: CalendarItem): number {
  return item.startsAt === null ? Number.NEGATIVE_INFINITY : Date.parse(item.startsAt);
}

/** Fuentes que no respondieron (`UNAVAILABLE` o `TIMEOUT`). */
export function incompleteSources(
  sources: readonly CalendarSourceState[],
): readonly CalendarSourceState[] {
  return sources.filter((source) => source.status !== 'OK');
}

/** Fuentes que llegaron recortadas a 200 elementos. */
export function truncatedSources(
  sources: readonly CalendarSourceState[],
): readonly CalendarSourceState[] {
  return sources.filter((source) => source.truncated);
}

/** Elementos de las fuentes elegidas en el filtro, en el mismo orden. */
export function itemsOfSources(
  items: readonly CalendarItem[],
  selected: ReadonlySet<CalendarSource>,
): readonly CalendarItem[] {
  return items.filter((item) => selected.has(item.source));
}

/** Cantidad de elementos por fuente, para el filtro. */
export function countBySource(items: readonly CalendarItem[]): ReadonlyMap<CalendarSource, number> {
  const counts = new Map<CalendarSource, number>();
  for (const item of items) {
    counts.set(item.source, (counts.get(item.source) ?? 0) + 1);
  }
  return counts;
}

export interface CalendarDay {
  /** `YYYY-MM-DD` en la zona del navegador. */
  readonly key: string;
  readonly items: readonly CalendarItem[];
}

/** Días con elementos, en orden, para la vista de lista. */
export function groupByDay(items: readonly CalendarItem[]): readonly CalendarDay[] {
  const days: { key: string; items: CalendarItem[] }[] = [];
  for (const item of items) {
    const last = days.at(-1);
    if (last?.key === item.day) {
      last.items.push(item);
    } else {
      days.push({ key: item.day, items: [item] });
    }
  }
  return days;
}

export interface CalendarMonthDay {
  /** `YYYY-MM-DD` en la zona del navegador. */
  readonly key: string;
  readonly day: number;
  readonly inMonth: boolean;
  readonly items: readonly CalendarItem[];
}

/**
 * Semanas del mes (lunes a domingo) con los elementos ubicados en su día en la
 * zona del navegador. Los días de los meses vecinos completan las semanas sin
 * elementos.
 */
export function integratedMonthWeeks(
  year: number,
  month: number,
  items: readonly CalendarItem[],
): readonly (readonly CalendarMonthDay[])[] {
  const byDay = new Map(groupByDay(items).map((day) => [day.key, day.items]));
  const first = new Date(year, month, 1);
  // getDay(): 0 = domingo. La semana empieza el lunes.
  const cursor = new Date(year, month, 1 - ((first.getDay() + 6) % 7));
  const weeks: CalendarMonthDay[][] = [];
  do {
    const week: CalendarMonthDay[] = [];
    for (let i = 0; i < 7; i++) {
      const key = localDayKey(cursor);
      const inMonth = cursor.getMonth() === month;
      week.push({
        key,
        day: cursor.getDate(),
        inMonth,
        items: inMonth ? (byDay.get(key) ?? []) : [],
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  } while (cursor.getMonth() === month);
  return weeks;
}

/** Fecha local `YYYY-MM-DD` como `Date` a medianoche en la zona del navegador. */
export function dayDate(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}
