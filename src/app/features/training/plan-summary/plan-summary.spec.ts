import { LOCALE_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { provideTranslateTesting } from '../../../../testing/translate-testing';
import { DEFAULT_LANGUAGE } from '../../../core/i18n/i18n.providers';
import { PlanSummary, PlanSummaryData } from './plan-summary';

// Datos sintéticos de prueba.
const PLAN: PlanSummaryData = {
  title: 'Base aeróbica',
  objectives: ['Mejorar la resistencia', 'Correr 10 km'],
  startDate: '2026-11-01',
  endDate: '2026-12-31',
  sessions: [
    { scheduledDate: '2026-11-01', sport: 'cycling', durationMinutes: 90, intensityRpe: 7 },
    { scheduledDate: '2026-11-02', sport: 'strength', durationMinutes: 40, intensityRpe: 5 },
  ],
};

describe('PlanSummary (HU010)', () => {
  let fixture: ComponentFixture<PlanSummary>;
  let element: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlanSummary],
      providers: [provideTranslateTesting(), { provide: LOCALE_ID, useValue: DEFAULT_LANGUAGE }],
    }).compileComponents();
    fixture = TestBed.createComponent(PlanSummary);
    fixture.componentRef.setInput('plan', PLAN);
    await fixture.whenStable();
    element = fixture.nativeElement as HTMLElement;
  });

  it('formatea el periodo en español sin desplazar las fechas por la zona horaria', () => {
    expect(element.querySelector('[data-testid="plan-summary-period"]')?.textContent?.trim()).toBe(
      'Del 1 de noviembre de 2026 al 31 de diciembre de 2026',
    );
  });

  it('lista objetivos y sesiones con deporte, minutos y RPE localizados', () => {
    expect([...element.querySelectorAll('li')].map((li) => li.textContent?.trim())).toEqual(
      PLAN.objectives,
    );
    const rows = [...element.querySelectorAll('tbody tr')].map((row) =>
      [...row.querySelectorAll('td')].map((cell) => cell.textContent?.trim()),
    );
    expect(rows[0][0]).toContain('1 nov 2026');
    expect(rows.map((row) => row.slice(1))).toEqual([
      ['Ciclismo', '90 min', 'RPE 7'],
      ['Fuerza', '40 min', 'RPE 5'],
    ]);
  });

  it('usa una tabla rotulada con encabezados de columna', () => {
    const table = element.querySelector('table')!;

    expect(table.getAttribute('aria-label')).toBe('Sesiones del plan');
    expect(table.querySelectorAll('th[scope="col"]').length).toBe(4);
  });

  it('respeta el nivel de encabezado de la página', async () => {
    expect(element.querySelectorAll('h2').length).toBe(2);

    fixture.componentRef.setInput('headingLevel', 3);
    await fixture.whenStable();

    expect(element.querySelectorAll('h2').length).toBe(0);
    expect(element.querySelectorAll('h3').length).toBe(2);
  });
});
