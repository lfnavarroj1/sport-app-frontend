import { LOCALE_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FOOD_CATALOG_RESPONSES } from '../../../../../testing/bff-web/nutrition.fixtures';
import { provideTranslateTesting } from '../../../../../testing/translate-testing';
import { DEFAULT_LANGUAGE } from '../../../../core/i18n/i18n.providers';
import { toFoodCatalog } from '../nutrition-plan.model';
import { NutritionPlanSummary, NutritionPlanSummaryData } from './nutrition-plan-summary';

// Datos sintéticos de prueba.
const PLAN: NutritionPlanSummaryData = {
  title: 'Recuperación tras la carrera',
  objectives: ['Mejorar la recuperación muscular'],
  startDate: '2026-11-02',
  endDate: '2026-11-29',
  meals: [
    {
      mealType: 'BREAKFAST',
      items: [
        { foodCode: 'OATS', quantity: '60.0', unit: 'G' },
        { foodCode: 'PEANUT_BUTTER', quantity: '1.5', unit: 'TBSP' },
      ],
    },
    { mealType: 'HYDRATION', items: [{ foodCode: 'WATER', quantity: '500.0', unit: 'ML' }] },
  ],
};

describe('NutritionPlanSummary (HU014)', () => {
  let fixture: ComponentFixture<NutritionPlanSummary>;
  let element: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NutritionPlanSummary],
      providers: [provideTranslateTesting(), { provide: LOCALE_ID, useValue: DEFAULT_LANGUAGE }],
    }).compileComponents();
    fixture = TestBed.createComponent(NutritionPlanSummary);
    fixture.componentRef.setInput('plan', PLAN);
    fixture.componentRef.setInput('catalog', toFoodCatalog(FOOD_CATALOG_RESPONSES.ok.body));
    await fixture.whenStable();
    element = fixture.nativeElement as HTMLElement;
  });

  function rows(): (string | undefined)[][] {
    return [...element.querySelectorAll('tbody tr')].map((row) =>
      [...row.querySelectorAll('td')].map((cell) => cell.textContent?.trim()),
    );
  }

  it('formatea el periodo en español sin desplazar las fechas por la zona horaria', () => {
    expect(
      element.querySelector('[data-testid="nutrition-summary-period"]')?.textContent?.trim(),
    ).toBe('Del 2 de noviembre de 2026 al 29 de noviembre de 2026');
  });

  it('presenta cada comida con los nombres del catálogo y cantidades localizadas, sin calorías', () => {
    expect(rows()).toEqual([
      ['Avena', '60 g'],
      ['Mantequilla de maní', '1,5 cda.'],
      ['Agua', '500 ml'],
    ]);
    expect(element.textContent).not.toMatch(/calor|kcal|nutriente/i);
  });

  it('usa tablas con título y encabezados de columna por comida', () => {
    const captions = [...element.querySelectorAll('caption')].map((c) => c.textContent?.trim());

    expect(captions).toEqual(['Comida 1: Desayuno', 'Comida 2: Hidratación']);
    for (const table of element.querySelectorAll('table')) {
      expect(table.querySelectorAll('th[scope="col"]').length).toBe(2);
    }
  });

  it('sin catálogo muestra el código del alimento en lugar de un texto vacío', async () => {
    fixture.componentRef.setInput('catalog', null);
    await fixture.whenStable();

    expect(rows().map((row) => row[0])).toEqual(['OATS', 'PEANUT_BUTTER', 'WATER']);
  });

  it('respeta el nivel de encabezado de la página', async () => {
    expect(element.querySelectorAll('h2').length).toBe(2);

    fixture.componentRef.setInput('headingLevel', 3);
    await fixture.whenStable();

    expect(element.querySelectorAll('h2').length).toBe(0);
    expect(element.querySelectorAll('h3').length).toBe(2);
  });
});
