import {
  EVENT_CONFLICTS_RESPONSES,
  MARCH_EVENTS,
} from '../../../../testing/bff-web/event-calendar.fixtures';
import {
  CalendarEvent,
  MAX_PERIOD_DAYS,
  daysPeriod,
  localDayKey,
  monthPeriod,
  monthWeeks,
  periodIssue,
  toCalendarEvent,
  toEventConflicts,
  toUtcIso,
} from './event-calendar.model';

/** Evento sintético que empieza al mediodía local del día indicado. */
function eventOn(year: number, month: number, day: number, id = `e-${day}`): CalendarEvent {
  const start = new Date(year, month, day, 12);
  return {
    id,
    name: `Evento ${day}`,
    discipline: 'Running',
    location: { name: 'Sede', city: 'Bogotá', countryCode: 'CO' },
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + 3_600_000).toISOString(),
    timeZone: 'America/Bogota',
  };
}

describe('Modelo del calendario de eventos (HU023)', () => {
  it('transforma los publicados sin organizador ni dirección', () => {
    const event = toCalendarEvent(MARCH_EVENTS[0]);

    expect(event).toEqual({
      id: MARCH_EVENTS[0].event_id,
      name: 'Media maratón de Bogotá',
      discipline: 'running',
      location: { name: 'Sede de Media maratón de Bogotá', city: 'Bogota', countryCode: 'CO' },
      startsAt: '2027-03-01T11:00:00Z',
      endsAt: '2027-03-01T15:00:00Z',
      timeZone: 'America/Bogota',
    });
  });

  it('transforma las coincidencias con sus motivos', () => {
    const conflicts = toEventConflicts(EVENT_CONFLICTS_RESPONSES.found.body);

    expect(conflicts.evaluatedAt).toBe('2026-10-23T15:00:00Z');
    expect(conflicts.conflicts.map((c) => [c.name, c.reasons])).toEqual([
      ['Media maratón de Bogotá', ['SAME_DISCIPLINE', 'SAME_CITY']],
      ['Triatlón de Bogotá', ['SAME_CITY']],
    ]);
  });

  it('el mes va de la medianoche del día 1 a la del mes siguiente, en la zona del navegador', () => {
    expect(monthPeriod(2027, 2)).toEqual({
      from: toUtcIso(new Date(2027, 2, 1)),
      to: toUtcIso(new Date(2027, 3, 1)),
    });
    expect(monthPeriod(2027, 11).to).toBe(toUtcIso(new Date(2028, 0, 1)));
    expect(toUtcIso(new Date(Date.UTC(2027, 2, 1, 5)))).toBe('2027-03-01T05:00:00Z');
  });

  it('el periodo por días incluye el último día completo', () => {
    expect(daysPeriod('2027-03-01', '2027-03-31')).toEqual({
      from: toUtcIso(new Date(2027, 2, 1)),
      to: toUtcIso(new Date(2027, 3, 1)),
    });
  });

  it('valida el periodo con la regla del backend: orden y máximo de 92 días (CA3)', () => {
    expect(MAX_PERIOD_DAYS).toBe(92);
    expect(periodIssue('2027-03-01', '2027-03-01')).toBeNull();
    expect(periodIssue('2027-03-02', '2027-03-01')).toBe('ends_before_starts');
    // 1 de marzo a 31 de mayo: 92 días completos.
    expect(periodIssue('2027-03-01', '2027-05-31')).toBeNull();
    expect(periodIssue('2027-03-01', '2027-06-01')).toBe('out_of_range');
  });

  it('arma las semanas de lunes a domingo y ubica cada evento en su día local de inicio', () => {
    const events = [eventOn(2027, 2, 1, 'a'), eventOn(2027, 2, 1, 'b'), eventOn(2027, 2, 31, 'c')];

    const weeks = monthWeeks(2027, 2, events);

    // Marzo de 2027 empieza en lunes y termina en miércoles.
    expect(weeks.length).toBe(5);
    expect(weeks.every((week) => week.length === 7)).toBeTrue();
    expect(weeks[0][0]).toEqual(
      jasmine.objectContaining({ key: '2027-03-01', day: 1, inMonth: true }),
    );
    expect(weeks[0][0].events.map((e) => e.id)).toEqual(['a', 'b']);
    expect(weeks[4][2].events.map((e) => e.id)).toEqual(['c']);
    expect(weeks[4][3]).toEqual(jasmine.objectContaining({ inMonth: false, events: [] }));
  });

  it('completa la primera semana con días del mes anterior', () => {
    // Abril de 2027 empieza en jueves: lunes 29 a miércoles 31 de marzo quedan fuera.
    const weeks = monthWeeks(2027, 3, [eventOn(2027, 2, 30)]);

    expect(weeks[0].slice(0, 3).map((day) => [day.key, day.inMonth])).toEqual([
      ['2027-03-29', false],
      ['2027-03-30', false],
      ['2027-03-31', false],
    ]);
    expect(weeks[0][1].events).toEqual([]);
    expect(localDayKey(new Date(2027, 3, 1))).toBe('2027-04-01');
  });
});
