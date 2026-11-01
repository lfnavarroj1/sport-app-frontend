import { LOCALE_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { MatSelectHarness } from '@angular/material/select/testing';

import { VALID_PUBLISH_ROUTINE_REQUEST } from '../../../../../../testing/bff-web/nutrition-routines.fixtures';
import { SIMULATED_FOOD_CATALOG } from '../../../../../../testing/bff-web/nutrition.fixtures';
import { provideTranslateTesting } from '../../../../../../testing/translate-testing';
import { DEFAULT_LANGUAGE } from '../../../../../core/i18n/i18n.providers';
import { toFoodCatalog } from '../../nutrition-plan.model';
import { RoutineDraft, RoutineViolation } from '../routines.model';
import { RoutineForm } from './routine-form';

describe('RoutineForm (HU030)', () => {
  let fixture: ComponentFixture<RoutineForm>;
  let element: HTMLElement;
  let loader: HarnessLoader;
  let submitted: RoutineDraft[];
  let edited: number;
  let cancelled: number;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RoutineForm],
      providers: [provideTranslateTesting(), { provide: LOCALE_ID, useValue: DEFAULT_LANGUAGE }],
    }).compileComponents();
    fixture = TestBed.createComponent(RoutineForm);
    fixture.componentRef.setInput('catalog', toFoodCatalog(SIMULATED_FOOD_CATALOG));
    submitted = [];
    edited = 0;
    cancelled = 0;
    fixture.componentInstance.submitted.subscribe((draft) => submitted.push(draft));
    fixture.componentInstance.edited.subscribe(() => edited++);
    fixture.componentInstance.cancelled.subscribe(() => cancelled++);
    loader = TestbedHarnessEnvironment.loader(fixture);
    await fixture.whenStable();
    element = fixture.nativeElement as HTMLElement;
  });

  const byTestId = (id: string) => element.querySelector<HTMLElement>(`[data-testid="${id}"]`);

  function input(selector: string): HTMLInputElement {
    return element.querySelector<HTMLInputElement>(selector)!;
  }

  function type(selector: string, value: string): void {
    const target = input(selector);
    target.value = value;
    target.dispatchEvent(new Event('input'));
    target.dispatchEvent(new Event('blur'));
  }

  async function choose(selector: string, option: string): Promise<void> {
    const select = await loader.getHarness(MatSelectHarness.with({ selector }));
    await select.open();
    await select.clickOptions({ text: option });
  }

  function button(label: string): HTMLButtonElement | undefined {
    return [...element.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.trim() === label,
    );
  }

  function check(label: string): void {
    const box = [
      ...element.querySelectorAll('[data-testid="routine-allergens"] mat-checkbox'),
    ].find((item) => item.textContent?.trim() === label);
    box!.querySelector<HTMLInputElement>('input')!.click();
  }

  async function submit(): Promise<void> {
    element.querySelector('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
  }

  const mealSelect = (m: number) => `[data-meal="${m}"] [formcontrolname="meal"]`;
  const item = (m: number, i: number, name: string) =>
    `[data-meal="${m}"] [data-item="${i}"] [formcontrolname="${name}"]`;

  async function fillItem(m: number, i: number, food: string, portions: string) {
    await choose(item(m, i, 'foodCode'), food);
    type(item(m, i, 'portions'), portions);
  }

  async function fillValid(): Promise<void> {
    type('[formcontrolname="title"]', ` ${VALID_PUBLISH_ROUTINE_REQUEST.title} `);
    type('[formcontrolname="description"]', ` ${VALID_PUBLISH_ROUTINE_REQUEST.description} `);
    await choose('[formcontrolname="goal"]', 'Rendimiento');
    await choose('[formcontrolname="sport"]', 'Carrera');
    await choose('[formcontrolname="dietaryPattern"]', 'Vegetariano');
    type('[formcontrolname="durationDays"]', '14');
    await choose(mealSelect(0), 'Desayuno');
    await fillItem(0, 0, 'Avena', '2');
    await fixture.whenStable();
  }

  const fieldText = (selector: string) =>
    input(selector).closest('mat-form-field')?.textContent ?? '';

  it('CA2 y CA4: envía la rutina normalizada con alérgenos declarados y comidas en orden', async () => {
    await fillValid();
    check('Leche');
    byTestId('routine-add-item-0')!.click();
    await fixture.whenStable();
    await fillItem(0, 1, 'Mantequilla de maní', '1');
    byTestId('routine-add-meal')!.click();
    await fixture.whenStable();
    await choose(mealSelect(1), 'Hidratación');
    await fillItem(1, 0, 'Agua', '4');
    await submit();

    expect(submitted).toEqual([
      {
        title: VALID_PUBLISH_ROUTINE_REQUEST.title,
        description: VALID_PUBLISH_ROUTINE_REQUEST.description,
        goal: 'PERFORMANCE',
        sport: 'running',
        dietaryPattern: 'VEGETARIAN',
        containsAllergens: ['MILK'],
        durationDays: 14,
        dailyMeals: [
          {
            meal: 'BREAKFAST',
            items: [
              { foodCode: 'OATS', portions: 2 },
              { foodCode: 'PEANUT_BUTTER', portions: 1 },
            ],
          },
          { meal: 'HYDRATION', items: [{ foodCode: 'WATER', portions: 4 }] },
        ],
      },
    ]);
    expect(edited).toBeGreaterThan(0);
  });

  it('CA2: el deporte es opcional y los alérgenos van en el orden del catálogo de HU009', async () => {
    await fillValid();
    await choose('[formcontrolname="sport"]', 'Sin deporte específico');
    check('Ajonjolí');
    check('Maní');
    await submit();

    expect(submitted.length).toBe(1);
    expect(submitted[0].sport).toBeNull();
    expect(submitted[0].containsAllergens).toEqual(['PEANUTS', 'SESAME']);
  });

  it('sin alérgenos marcados envía la lista vacía', async () => {
    await fillValid();
    await submit();

    expect(submitted[0].containsAllergens).toEqual([]);
  });

  it('no envía una rutina incompleta y marca lo que falta', async () => {
    await submit();

    expect(submitted).toEqual([]);
    expect(element.querySelectorAll('mat-error').length).toBeGreaterThan(5);
  });

  it('respeta las longitudes del contrato tras recortar', async () => {
    await fillValid();
    type('[formcontrolname="title"]', ' ab ');
    type('[formcontrolname="description"]', '   ');
    await submit();

    expect(submitted).toEqual([]);
    expect(fieldText('[formcontrolname="title"]')).toContain('3');
    expect(fieldText('[formcontrolname="description"]')).toContain('obligatorio');

    type('[formcontrolname="title"]', 'x'.repeat(121));
    type('[formcontrolname="description"]', 'Rutina.');
    await submit();
    expect(submitted).toEqual([]);
    expect(fieldText('[formcontrolname="title"]')).toContain('120');
  });

  it('los días y las porciones son enteros dentro del rango del contrato', async () => {
    await fillValid();
    type('[formcontrolname="durationDays"]', '91');
    type(item(0, 0, 'portions'), '0');
    await submit();
    expect(submitted).toEqual([]);
    expect(fieldText('[formcontrolname="durationDays"]')).toContain('90');
    expect(fieldText(item(0, 0, 'portions'))).toContain('1');

    type('[formcontrolname="durationDays"]', '1.5');
    type(item(0, 0, 'portions'), '11');
    await submit();
    expect(submitted).toEqual([]);
    expect(fieldText('[formcontrolname="durationDays"]')).toContain('Usa un número entero.');
    expect(fieldText(item(0, 0, 'portions'))).toContain('10');
  });

  it('el selector de alimentos usa el catálogo agrupado por categoría', async () => {
    const select = await loader.getHarness(
      MatSelectHarness.with({ selector: item(0, 0, 'foodCode') }),
    );
    await select.open();
    const groups = await select.getOptionGroups();

    expect(await Promise.all(groups.map((group) => group.getLabelText()))).toEqual([
      'Cereales y granos',
      'Proteínas',
      'Lácteos',
      'Frutas',
      'Grasas',
      'Bebidas',
    ]);
    expect((await select.getOptions()).length).toBe(SIMULATED_FOOD_CATALOG.items.length);
  });

  it('agrega y quita comidas (1 a 8) y alimentos (1 a 15) con controles accesibles', async () => {
    const removeMeal = (n: number) =>
      element.querySelector<HTMLButtonElement>(`[aria-label="Quitar la comida ${n}"]`)!;
    const removeItem = (meal: number, n: number) =>
      element.querySelector<HTMLButtonElement>(
        `[aria-label="Quitar el alimento ${n} de la comida ${meal}"]`,
      )!;

    expect(element.querySelectorAll('[data-meal]').length).toBe(1);
    expect(removeMeal(1).disabled).toBeTrue();
    expect(removeItem(1, 1).disabled).toBeTrue();

    byTestId('routine-add-item-0')!.click();
    await fixture.whenStable();
    expect(
      element.querySelector('[data-meal="0"] [data-item="1"]')?.getAttribute('aria-label'),
    ).toBe('Comida 1, alimento 2');
    expect(removeItem(1, 2).disabled).toBeFalse();
    removeItem(1, 2).click();
    await fixture.whenStable();
    expect(element.querySelectorAll('[data-meal="0"] [data-item]').length).toBe(1);

    for (let count = 1; count < 15; count++) {
      byTestId('routine-add-item-0')!.click();
    }
    await fixture.whenStable();
    expect(element.querySelectorAll('[data-meal="0"] [data-item]').length).toBe(15);
    expect(byTestId('routine-add-item-0')!.hasAttribute('disabled')).toBeTrue();

    for (let count = 1; count < 8; count++) {
      byTestId('routine-add-meal')!.click();
    }
    await fixture.whenStable();
    expect(element.querySelectorAll('[data-meal]').length).toBe(8);
    expect(byTestId('routine-add-meal')!.hasAttribute('disabled')).toBeTrue();
    expect(element.querySelector('[data-meal="7"] legend')?.textContent?.trim()).toBe('Comida 8');
    removeMeal(8).click();
    await fixture.whenStable();
    expect(element.querySelectorAll('[data-meal]').length).toBe(7);
  });

  it('cada control tiene su etiqueta visible y los alérgenos forman un grupo con leyenda', async () => {
    const labels = [...element.querySelectorAll('[data-meal="0"] mat-label')].map((label) =>
      label.textContent?.trim(),
    );
    expect(labels).toEqual(['Tipo de comida', 'Alimento 1', 'Porciones del alimento 1']);

    const allergens = byTestId('routine-allergens')!;
    expect(allergens.tagName).toBe('FIELDSET');
    expect(allergens.querySelector('legend')?.textContent?.trim()).toBe('Alérgenos que contiene');
    expect(allergens.querySelectorAll('mat-checkbox').length).toBe(9);
    expect(byTestId('routine-disclaimer')?.textContent).toContain('no reemplaza');
  });

  it('CA4: marca las reglas del backend en su campo, comida o alimento, y las resume', async () => {
    await fillValid();
    byTestId('routine-add-item-0')!.click();
    byTestId('routine-add-meal')!.click();
    await fixture.whenStable();
    const violations: RoutineViolation[] = [
      { field: 'title', issue: 'invalid_length' },
      { field: 'contains_allergens', issue: 'duplicate_value' },
      { field: 'daily_meals.0.items.1.food_code', issue: 'unknown_value' },
      { field: 'daily_meals.1.items.0.food_code', issue: 'conflicts_with_restriction' },
      { field: 'daily_meals.1.items', issue: 'too_short' },
      { field: 'professional_id', issue: 'extra_forbidden' },
    ];
    fixture.componentRef.setInput('serverErrors', violations);
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();

    const summary = byTestId('routine-errors')!;
    expect(document.activeElement).toBe(summary);
    expect(summary.getAttribute('role')).toBe('alert');
    expect([...summary.querySelectorAll('li')].map((li) => li.textContent?.trim())).toEqual([
      'Título: La longitud no es válida.',
      'Alérgenos que contiene: Hay valores repetidos.',
      'Comida 1, alimento 2: El valor no existe en el catálogo.',
      'Comida 2, alimento 1: El alimento no es compatible con el patrón alimentario de la rutina.',
      'Comida 2 (alimentos): El valor está fuera del rango permitido.',
      'Solicitud: Este dato no se puede enviar.',
    ]);
    expect(fieldText('[formcontrolname="title"]')).toContain('La longitud no es válida.');
    expect(fieldText(item(0, 1, 'foodCode'))).toContain('no existe en el catálogo');
    expect(fieldText(item(1, 0, 'foodCode'))).toContain('no es compatible con el patrón');
    expect(byTestId('routine-allergens-error')?.textContent).toContain('Hay valores repetidos.');
    expect(byTestId('routine-meal-error-1')?.textContent).toContain('fuera del rango');
  });

  it('al editar se retiran las marcas del backend; el resumen sigue', async () => {
    await fillValid();
    fixture.componentRef.setInput('serverErrors', [
      { field: 'title', issue: 'invalid_length' },
      { field: 'contains_allergens', issue: 'duplicate_value' },
    ] satisfies RoutineViolation[]);
    await fixture.whenStable();
    expect(fieldText('[formcontrolname="title"]')).toContain('La longitud no es válida.');

    type('[formcontrolname="title"]', 'Desayuno renovado');
    await fixture.whenStable();
    expect(fieldText('[formcontrolname="title"]')).not.toContain('La longitud no es válida.');
    expect(byTestId('routine-allergens-error')).toBeNull();
    expect(byTestId('routine-errors')).not.toBeNull();
  });

  it('un alimento inexistente en el formulario o la lista completa solo aparecen en el resumen', async () => {
    await fillValid();
    fixture.componentRef.setInput('serverErrors', [
      { field: 'daily_meals.5.items.0.food_code', issue: 'unknown_value' },
      { field: 'daily_meals', issue: 'too_long' },
    ] satisfies RoutineViolation[]);
    await fixture.whenStable();

    expect(
      [...byTestId('routine-errors')!.querySelectorAll('li')].map((li) => li.textContent?.trim()),
    ).toEqual([
      'Comida 6, alimento 1: El valor no existe en el catálogo.',
      'Comidas del día tipo: El valor está fuera del rango permitido.',
    ]);
  });

  it('no envía mientras publica y «Cancelar» avisa sin enviar', async () => {
    await fillValid();
    fixture.componentRef.setInput('submitting', true);
    await fixture.whenStable();

    expect(button('Publicando…')?.disabled).toBeTrue();
    await submit();
    expect(submitted).toEqual([]);

    fixture.componentRef.setInput('submitting', false);
    await fixture.whenStable();
    button('Cancelar')!.click();
    expect(cancelled).toBe(1);
  });
});
