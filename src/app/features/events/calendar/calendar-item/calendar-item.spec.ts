import { LOCALE_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  OWN_DRAFT_ITEM,
  OWN_SERVICE_DRAFT_ITEM,
  REGISTRATION_ITEM,
  TRAINING_SESSION_ITEM,
} from '../../../../../testing/bff-web/integrated-calendar.fixtures';
import { provideTranslateTesting } from '../../../../../testing/translate-testing';
import { IntegratedCalendarItemDto } from '../../../../core/api/bff-web/integrated-calendar.api';
import { DEFAULT_LANGUAGE } from '../../../../core/i18n/i18n.providers';
import { browserTimeZone } from '../../create-event/event-time';
import { toCalendarItem } from '../integrated-calendar.model';
import { CalendarItemView } from './calendar-item';

describe('CalendarItemView (HU018)', () => {
  let fixture: ComponentFixture<CalendarItemView>;

  async function render(dto: IntegratedCalendarItemDto, compact = false): Promise<HTMLElement> {
    await TestBed.configureTestingModule({
      imports: [CalendarItemView],
      providers: [provideTranslateTesting(), { provide: LOCALE_ID, useValue: DEFAULT_LANGUAGE }],
    }).compileComponents();
    fixture = TestBed.createComponent(CalendarItemView);
    fixture.componentRef.setInput('item', toCalendarItem(dto));
    fixture.componentRef.setInput('compact', compact);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  const text = (element: HTMLElement, id: string) =>
    (element.querySelector(`[data-testid="${id}"]`)?.textContent ?? '').replace(/\s+/g, ' ').trim();

  it('dice con texto la fuente y el estado, no solo con color (CA1)', async () => {
    const element = await render(OWN_DRAFT_ITEM);

    expect(text(element, 'calendar-item-source')).toBe('Mis eventos');
    expect(text(element, 'calendar-item-status')).toBe('Borrador');
    expect(element.getAttribute('data-source')).toBe('OWN_EVENT');
    expect(element.classList).toContain('calendar-item--draft');
    expect(element.textContent).toContain('Running · Parque Simón Bolívar, Bogotá');
  });

  it('muestra la hora local del dominio cuando su zona difiere de la del navegador (CA3)', async () => {
    const zone = browserTimeZone() === 'Pacific/Kiritimati' ? 'Asia/Tokyo' : 'Pacific/Kiritimati';
    const element = await render({ ...REGISTRATION_ITEM, time_zone: zone });

    expect(text(element, 'calendar-item-zone')).toContain(`Hora local:`);
    expect(text(element, 'calendar-item-zone')).toContain(zone);
    expect(text(element, 'calendar-item-status')).toBe('Inscrito');
  });

  it('con la zona del navegador solo la nombra', async () => {
    const element = await render({ ...REGISTRATION_ITEM, time_zone: browserTimeZone() });

    expect(text(element, 'calendar-item-zone')).toBe(`Zona: ${browserTimeZone()}`);
  });

  it('una sesión sin hora no muestra zona y conserva su duración y esfuerzo', async () => {
    const element = await render(TRAINING_SESSION_ITEM);

    expect(text(element, 'calendar-item-time')).toBe('Sin hora fija');
    expect(element.querySelector('[data-testid="calendar-item-zone"]')).toBeNull();
    expect(element.textContent).toContain('Carrera');
    expect(text(element, 'calendar-item-status')).toBe('Asignada');
  });

  it('traduce la categoría conocida y muestra tal cual un valor que no conoce', async () => {
    const element = await render({ ...OWN_SERVICE_DRAFT_ITEM, category: 'OTRA_CATEGORIA' });

    expect(element.textContent).toContain('OTRA_CATEGORIA');
    expect(element.textContent).not.toContain('VIRTUAL');
    expect(element.textContent).toContain('cupo: 5');
  });

  it('en la celda del mes solo deja fuente, título, hora y estado', async () => {
    const element = await render(OWN_DRAFT_ITEM, true);

    expect(element.textContent).not.toContain('Parque Simón Bolívar');
    expect(text(element, 'calendar-item-time')).not.toContain('–');
  });
});
