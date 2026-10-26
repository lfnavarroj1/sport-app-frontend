import { LOCALE_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { provideTranslateTesting } from '../../../../../testing/translate-testing';
import { DEFAULT_LANGUAGE } from '../../../../core/i18n/i18n.providers';
import { browserTimeZone } from '../../create-event/event-time';
import { CalendarEntry, CalendarEventItem } from './calendar-event-item';

// Datos sintéticos de prueba.
const ENTRY: CalendarEntry = {
  name: 'Media maratón de Bogotá',
  discipline: 'Running',
  city: 'Bogotá',
  startsAt: '2027-03-01T11:00:00Z',
  endsAt: '2027-03-01T15:00:00Z',
  timeZone: 'America/Bogota',
};

describe('CalendarEventItem (HU023)', () => {
  let fixture: ComponentFixture<CalendarEventItem>;
  let element: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CalendarEventItem],
      providers: [provideTranslateTesting(), { provide: LOCALE_ID, useValue: DEFAULT_LANGUAGE }],
    }).compileComponents();
    fixture = TestBed.createComponent(CalendarEventItem);
    element = fixture.nativeElement as HTMLElement;
  });

  async function render(entry: CalendarEntry, inputs: Record<string, unknown> = {}): Promise<void> {
    fixture.componentRef.setInput('entry', entry);
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    await fixture.whenStable();
  }

  function testId(id: string): string | undefined {
    return element.querySelector(`[data-testid="${id}"]`)?.textContent?.replace(/\s+/g, ' ').trim();
  }

  it('muestra nombre, disciplina, ciudad y el horario en la zona del navegador (CA4)', async () => {
    await render(ENTRY);

    expect(element.textContent).toContain('Media maratón de Bogotá');
    expect(element.textContent).toContain('Running · Bogotá');
    const start = new Intl.DateTimeFormat('es', {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(ENTRY.startsAt));
    expect(testId('calendar-event-time')).toContain(start);
  });

  it('la zona del evento siempre es visible; si difiere, también su hora local (CA4)', async () => {
    await render(ENTRY);
    const zone = testId('calendar-event-zone')!;
    if (browserTimeZone() === 'America/Bogota') {
      expect(zone).toBe('Zona del evento: America/Bogota');
    } else {
      expect(zone).toContain('(America/Bogota)');
    }

    await render({ ...ENTRY, timeZone: 'Asia/Tokyo' });
    expect(testId('calendar-event-zone')).toMatch(/^Hora del evento: .+ \(Asia\/Tokyo\)$/);
    expect(testId('calendar-event-zone')).toContain('20:00');
  });

  it('dice con texto los motivos de una coincidencia, no solo con color (CA2)', async () => {
    await render(ENTRY, { reasons: ['SAME_DISCIPLINE', 'SAME_CITY'] });

    expect(testId('calendar-event-conflict')).toBe('Coincide: misma disciplina, misma ciudad');
    expect(element.classList).toContain('calendar-event--conflict');
  });

  it('marca el evento propio elegido y no muestra motivos si no coincide', async () => {
    await render(ENTRY, { own: true });

    expect(testId('calendar-event-own')).toBe('Mi evento');
    expect(element.querySelector('[data-testid="calendar-event-conflict"]')).toBeNull();
  });

  it('en la celda del mes muestra la hora de inicio y la ciudad', async () => {
    await render(ENTRY, { compact: true });

    expect(element.querySelector('[data-testid="calendar-event-time"]')).toBeNull();
    expect(element.textContent).toContain('· Bogotá');
  });
});
