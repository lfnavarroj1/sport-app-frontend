import { LOCALE_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { provideTranslateTesting } from '../../../../../testing/translate-testing';
import { DEFAULT_LANGUAGE } from '../../../../core/i18n/i18n.providers';
import { CalendarEvent, localDayKey } from '../event-calendar.model';
import { CalendarMonth } from './calendar-month';

/** Evento sintético que empieza al mediodía local del día indicado de marzo de 2027. */
function eventOn(day: number, id: string): CalendarEvent {
  const start = new Date(2027, 2, day, 12);
  return {
    id,
    name: `Evento ${id}`,
    discipline: 'Running',
    location: { name: 'Sede', city: 'Bogotá', countryCode: 'CO' },
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + 3_600_000).toISOString(),
    timeZone: 'America/Bogota',
  };
}

describe('CalendarMonth (HU023)', () => {
  let fixture: ComponentFixture<CalendarMonth>;
  let element: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CalendarMonth],
      providers: [provideTranslateTesting(), { provide: LOCALE_ID, useValue: DEFAULT_LANGUAGE }],
    }).compileComponents();
    fixture = TestBed.createComponent(CalendarMonth);
    fixture.componentRef.setInput('year', 2027);
    fixture.componentRef.setInput('month', 2);
    fixture.componentRef.setInput('events', [eventOn(1, 'a'), eventOn(1, 'b'), eventOn(15, 'c')]);
    await fixture.whenStable();
    element = fixture.nativeElement as HTMLElement;
  });

  it('es una tabla rotulada con el mes y los días de lunes a domingo', () => {
    const table = element.querySelector('table')!;

    expect(table.querySelector('caption')?.textContent?.trim()).toBe('marzo 2027');
    const headers = [...table.querySelectorAll('th[scope="col"]')].map((th) =>
      th.querySelector('abbr')?.getAttribute('title'),
    );
    expect(headers).toEqual([
      'lunes',
      'martes',
      'miércoles',
      'jueves',
      'viernes',
      'sábado',
      'domingo',
    ]);
    expect(table.querySelectorAll('tbody tr').length).toBe(5);
  });

  it('ubica cada evento en su día con una lista rotulada por la fecha', () => {
    const day1 = element.querySelector(`[data-day="${localDayKey(new Date(2027, 2, 1))}"]`)!;
    const list = day1.querySelector('ul')!;

    expect(list.getAttribute('aria-label')).toBe('Eventos del 1 de marzo de 2027');
    expect([...list.querySelectorAll('li')].map((li) => li.getAttribute('data-event'))).toEqual([
      'a',
      'b',
    ]);
    expect(element.querySelector('[data-day="2027-03-02"] ul')).toBeNull();
  });

  it('resalta las coincidencias y el evento propio elegido (CA2)', async () => {
    fixture.componentRef.setInput('conflicts', new Map([['c', ['SAME_CITY']]]));
    fixture.componentRef.setInput('ownEventId', 'a');
    await fixture.whenStable();

    expect(
      element.querySelector('[data-event="c"] [data-testid="calendar-event-conflict"]')
        ?.textContent,
    ).toContain('misma ciudad');
    expect(
      element.querySelector('[data-event="a"] [data-testid="calendar-event-own"]'),
    ).not.toBeNull();
    expect(
      element.querySelector('[data-event="b"] [data-testid="calendar-event-conflict"]'),
    ).toBeNull();
  });
});
