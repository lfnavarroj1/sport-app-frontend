import {
  INTEGRATED_CALENDAR_RESPONSES,
  OWN_PUBLISHED_ITEM,
  TRAINING_SESSION_ITEM,
} from '../../../../testing/bff-web/integrated-calendar.fixtures';
import { IntegratedCalendarResponseDto } from '../../../core/api/bff-web/integrated-calendar.api';
import { localDayKey } from '../event-calendar/event-calendar.model';
import {
  CalendarItem,
  countBySource,
  groupByDay,
  incompleteSources,
  integratedMonthWeeks,
  itemStatusKey,
  itemsOfSources,
  sourceKey,
  sourceStatusKey,
  toCalendarItem,
  toIntegratedCalendar,
  truncatedSources,
} from './integrated-calendar.model';

const athlete = (): IntegratedCalendarResponseDto => INTEGRATED_CALENDAR_RESPONSES.athlete.body;

describe('integrated-calendar.model (HU018)', () => {
  it('transforma cada elemento con su fuente, estado, referencia y detalle del dominio (CA1)', () => {
    const calendar = toIntegratedCalendar(athlete());

    expect(calendar.items.map((item) => [item.source, item.status])).toEqual([
      ['TRAINING_PLAN_SESSION', 'ASSIGNED'],
      ['EVENT_PUBLISHED', 'PUBLISHED'],
      ['EVENT_REGISTRATION', 'REGISTERED'],
      ['ASSOCIATED_SERVICE_AVAILABILITY', 'AVAILABLE'],
    ]);
    expect(calendar.items[2].reference).toEqual(athlete().items[2].reference);
    expect(calendar.items[3].detail).toEqual({
      kind: 'service',
      category: 'SPORTS_MEDICINE',
      modality: 'IN_PERSON',
      capacity: 1,
    });
    expect(calendar.sources.map((source) => source.name)).toEqual([
      'EVENT_PUBLISHED',
      'TRAINING_PLAN_SESSION',
      'ASSOCIATED_SERVICE_AVAILABILITY',
      'EVENT_REGISTRATION',
    ]);
    expect(calendar.evaluatedAt).toBe(athlete().evaluated_at);
  });

  it('una sesión sin hora conserva su fecha (`occurs_on`) y su detalle', () => {
    const session = toCalendarItem(TRAINING_SESSION_ITEM);

    expect(session.day).toBe('2027-03-03');
    expect(session.startsAt).toBeNull();
    expect(session.timeZone).toBeNull();
    expect(session.detail).toEqual({
      kind: 'session',
      sport: 'running',
      durationMinutes: 45,
      rpe: 4,
    });
  });

  it('ubica un elemento con hora en su día de la zona del navegador, conservando instante y zona (CA3)', () => {
    const item = toCalendarItem(OWN_PUBLISHED_ITEM);

    expect(item.startsAt).toBe('2027-03-19T23:30:00Z');
    expect(item.timeZone).toBe('Europe/Madrid');
    expect(item.day).toBe(localDayKey(new Date('2027-03-19T23:30:00Z')));
  });

  it('ordena por día del navegador y, en el día, lo que no tiene hora primero', () => {
    // Mediodía UTC cae el mismo día en cualquier zona de UTC−11 a UTC+11.
    const noon = {
      ...OWN_PUBLISHED_ITEM,
      item_id: 'OWN_EVENT:noon',
      occurs_on: '2027-03-10',
      starts_at: '2027-03-10T12:00:00Z',
      ends_at: '2027-03-10T14:00:00Z',
    };
    const earlier = {
      ...noon,
      item_id: 'OWN_EVENT:earlier',
      occurs_on: '2027-03-05',
      starts_at: '2027-03-05T12:00:00Z',
      ends_at: '2027-03-05T14:00:00Z',
    };
    const session = { ...TRAINING_SESSION_ITEM, occurs_on: '2027-03-10' };
    const calendar = toIntegratedCalendar({ ...athlete(), items: [noon, session, earlier] });

    expect(calendar.items.map((item) => item.id)).toEqual([
      earlier.item_id,
      session.item_id,
      noon.item_id,
    ]);
  });

  it('declara las fuentes incompletas y las truncadas (CA5, CA6)', () => {
    const partial = toIntegratedCalendar(INTEGRATED_CALENDAR_RESPONSES.athletePartial.body);
    const truncated = toIntegratedCalendar(
      INTEGRATED_CALENDAR_RESPONSES.serviceProviderTruncated.body,
    );

    expect(incompleteSources(partial.sources).map((s) => [s.name, s.status])).toEqual([
      ['TRAINING_PLAN_SESSION', 'UNAVAILABLE'],
      ['ASSOCIATED_SERVICE_AVAILABILITY', 'TIMEOUT'],
    ]);
    expect(truncatedSources(partial.sources)).toEqual([]);
    expect(truncatedSources(truncated.sources).map((s) => s.name)).toEqual(['EVENT_PUBLISHED']);
    expect(incompleteSources(truncated.sources)).toEqual([]);
  });

  it('filtra por fuente, cuenta por fuente y agrupa por día', () => {
    const { items } = toIntegratedCalendar(athlete());

    expect(itemsOfSources(items, new Set(['EVENT_PUBLISHED'])).map((i) => i.source)).toEqual([
      'EVENT_PUBLISHED',
    ]);
    expect(itemsOfSources(items, new Set())).toEqual([]);
    expect([...countBySource(items)]).toEqual([
      ['TRAINING_PLAN_SESSION', 1],
      ['EVENT_PUBLISHED', 1],
      ['EVENT_REGISTRATION', 1],
      ['ASSOCIATED_SERVICE_AVAILABILITY', 1],
    ]);
    expect(groupByDay(items).map((day) => [day.key, day.items.length])).toEqual(
      [...new Set(items.map((item) => item.day))].map((key) => [
        key,
        items.filter((item) => item.day === key).length,
      ]),
    );
  });

  it('arma el mes de lunes a domingo con cada elemento en su día', () => {
    const items: CalendarItem[] = [toCalendarItem(TRAINING_SESSION_ITEM)];
    const weeks = integratedMonthWeeks(2027, 2, items);
    const days = weeks.flat();

    // Marzo de 2027 empieza en lunes y termina en miércoles: cinco semanas.
    expect(weeks.length).toBe(5);
    expect(weeks.every((week) => week.length === 7)).toBeTrue();
    expect(days[0]).toEqual(jasmine.objectContaining({ key: '2027-03-01', inMonth: true }));
    expect(days.find((day) => day.key === '2027-03-03')?.items).toEqual(items);
    expect(days.at(-1)).toEqual(
      jasmine.objectContaining({ key: '2027-04-04', inMonth: false, items: [] }),
    );
  });
});

describe('integrated-calendar.model ante valores que el contrato 0.30.0 no declara', () => {
  // Valores claramente ficticios: una versión compatible posterior del BFF puede
  // agregar fuentes, pero ninguna se implementa aquí como comportamiento final.
  const unknownItem = {
    item_id: 'UNKNOWN_SOURCE:ficticio-1',
    source: 'UNKNOWN_SOURCE',
    status: 'UNKNOWN_STATUS',
    occurs_on: '2027-03-09',
    title: 'Elemento de una fuente futura',
    starts_at: '2027-03-09T15:00:00Z',
    ends_at: '2027-03-09T16:00:00Z',
    time_zone: 'America/Bogota',
    unknown_field: { nested: true },
  };
  const withUnknown = (items: object[], sources: object[]) =>
    ({
      ...athlete(),
      items: [...athlete().items, ...items],
      sources: [...athlete().sources, ...sources],
    }) as unknown as IntegratedCalendarResponseDto;

  it('muestra de forma genérica un elemento de una fuente desconocida, sin perder los demás', () => {
    const calendar = toIntegratedCalendar(
      withUnknown([unknownItem], [{ name: 'UNKNOWN_SOURCE', status: 'OK', truncated: false }]),
    );
    const generic = calendar.items.find((item) => item.source === 'UNKNOWN_SOURCE')!;

    expect(calendar.items.length).toBe(5);
    expect(generic).toEqual(
      jasmine.objectContaining({
        id: 'UNKNOWN_SOURCE:ficticio-1',
        title: 'Elemento de una fuente futura',
        startsAt: '2027-03-09T15:00:00Z',
        detail: { kind: 'other' },
        reference: {},
      }),
    );
    expect(sourceKey('UNKNOWN_SOURCE')).toBe('events.integratedCalendar.sources.unknown');
    expect(itemStatusKey('UNKNOWN_STATUS')).toBe('events.integratedCalendar.status.unknown');
    expect(sourceKey('OWN_EVENT')).toBe('events.integratedCalendar.sources.OWN_EVENT');
  });

  it('omite un elemento desconocido sin título o fecha válidos', () => {
    const calendar = toIntegratedCalendar(
      withUnknown(
        [
          {
            item_id: 'UNKNOWN_SOURCE:sin-titulo',
            source: 'UNKNOWN_SOURCE',
            occurs_on: '2027-03-09',
          },
          { ...unknownItem, item_id: 'UNKNOWN_SOURCE:fecha', occurs_on: 'mañana' },
        ],
        [],
      ),
    );

    expect(calendar.items.length).toBe(4);
  });

  it('un estado de fuente desconocido cuenta como incompleto, con texto genérico', () => {
    const calendar = toIntegratedCalendar(
      withUnknown([], [{ name: 'UNKNOWN_SOURCE', status: 'UNKNOWN_STATUS', truncated: false }]),
    );

    expect(incompleteSources(calendar.sources).map((source) => source.name)).toEqual([
      'UNKNOWN_SOURCE',
    ]);
    expect(sourceStatusKey('UNKNOWN_STATUS')).toBe(
      'events.integratedCalendar.sourceStatus.unknown',
    );
    expect(sourceStatusKey('TIMEOUT')).toBe('events.integratedCalendar.sourceStatus.TIMEOUT');
  });
});
