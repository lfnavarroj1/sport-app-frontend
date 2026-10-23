import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FOOD_CATALOG_RESPONSES } from '../../../../../../testing/bff-web/nutrition.fixtures';
import { provideTranslateTesting } from '../../../../../../testing/translate-testing';
import { NutritionPlanDraft, toFoodCatalog } from '../../nutrition-plan.model';
import {
  NutritionPlanForm,
  NutritionPlanServerErrors,
  normalizeQuantity,
} from './nutrition-plan-form';

// Datos sintéticos de prueba.
const CATALOG = toFoodCatalog(FOOD_CATALOG_RESPONSES.ok.body);

describe('NutritionPlanForm (HU014)', () => {
  let fixture: ComponentFixture<NutritionPlanForm>;
  let element: HTMLElement;
  let reviewed: NutritionPlanDraft[];
  let edited: number;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NutritionPlanForm],
      providers: [provideTranslateTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(NutritionPlanForm);
    fixture.componentRef.setInput('catalog', CATALOG);
    reviewed = [];
    edited = 0;
    fixture.componentInstance.reviewed.subscribe((draft) => reviewed.push(draft));
    fixture.componentInstance.edited.subscribe(() => edited++);
    await fixture.whenStable();
    element = fixture.nativeElement as HTMLElement;
  });

  function input(selector: string, index = 0): HTMLInputElement {
    return element.querySelectorAll<HTMLInputElement>(selector)[index];
  }

  function type(target: HTMLInputElement, value: string): void {
    target.value = value;
    target.dispatchEvent(new Event('input'));
    target.dispatchEvent(new Event('blur'));
  }

  function button(text: string, index = 0): HTMLButtonElement {
    return [...element.querySelectorAll<HTMLButtonElement>('button')].filter((b) =>
      b.textContent?.includes(text),
    )[index];
  }

  /** Opciones del panel abierto: el de una selección anterior puede seguir cerrándose. */
  function openOptions(): HTMLElement[] {
    const panels = document.querySelectorAll<HTMLElement>('.mat-mdc-select-panel');
    return [...(panels.item(panels.length - 1)?.querySelectorAll<HTMLElement>('mat-option') ?? [])];
  }

  async function choose(trigger: HTMLElement, label: string): Promise<void> {
    trigger.click();
    await fixture.whenStable();
    const option = openOptions().find((o) => o.textContent?.trim() === label);
    option!.click();
    await fixture.whenStable();
  }

  function item(meal: number, index: number): HTMLElement {
    return element.querySelector<HTMLElement>(`[data-testid="nutrition-item-${meal}-${index}"]`)!;
  }

  function select(scope: HTMLElement, control: string): HTMLElement {
    return scope.querySelector<HTMLElement>(`mat-select[formcontrolname="${control}"]`)!;
  }

  async function fillItem(meal: number, index: number, food: string, quantity: string) {
    await choose(select(item(meal, index), 'foodCode'), food);
    type(
      item(meal, index).querySelector<HTMLInputElement>('[formcontrolname="quantity"]')!,
      quantity,
    );
  }

  async function fillValid(): Promise<void> {
    type(input('[formcontrolname="athleteEmail"]'), '  deportista@example.com ');
    type(input('[formcontrolname="title"]'), ' Recuperación ');
    type(input('[data-focus="objective"]'), ' Mejorar la recuperación ');
    type(input('[formcontrolname="startDate"]'), '2026-11-02');
    type(input('[formcontrolname="endDate"]'), '2026-11-29');
    const meal = element.querySelector<HTMLElement>('[data-meal="0"]')!;
    await choose(select(meal, 'mealType'), 'Desayuno');
    await fillItem(0, 0, 'Avena', '60');
    await fixture.whenStable();
  }

  async function submit(): Promise<void> {
    element.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
  }

  async function setServerErrors(errors: NutritionPlanServerErrors): Promise<void> {
    fixture.componentRef.setInput('serverErrors', errors);
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  }

  it('empieza con un objetivo y una comida con un alimento, que no se pueden quitar', () => {
    expect(element.querySelectorAll('[data-focus="objective"]').length).toBe(1);
    expect(element.querySelectorAll('[data-meal]').length).toBe(1);
    expect(element.querySelectorAll('[data-item]').length).toBe(1);
    for (const label of [
      'Quitar el objetivo 1',
      'Quitar la comida 1',
      'Quitar el alimento 1 de la comida 1',
    ]) {
      expect(
        element.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.disabled,
      ).toBeTrue();
    }
  });

  it('no permite revisar un plan incompleto y señala los campos obligatorios', async () => {
    await submit();

    expect(reviewed).toEqual([]);
    expect(element.textContent).toContain('Este campo es obligatorio.');
  });

  it('ofrece los alimentos del catálogo agrupados por categoría con sus nombres', async () => {
    select(item(0, 0), 'foodCode').click();
    await fixture.whenStable();

    const groups = [...document.querySelectorAll('mat-optgroup')].map((g) =>
      g.querySelector('.mat-mdc-optgroup-label')?.textContent?.trim(),
    );
    expect(groups).toEqual([
      'Cereales y granos',
      'Proteínas',
      'Lácteos',
      'Frutas',
      'Grasas',
      'Bebidas',
    ]);
    expect(document.body.textContent).toContain('Mantequilla de maní');
  });

  it('propone la unidad por defecto del alimento y solo ofrece sus unidades permitidas', async () => {
    await choose(select(item(0, 0), 'foodCode'), 'Agua');

    expect(select(item(0, 0), 'unit').textContent).toContain('Mililitros (ml)');
    select(item(0, 0), 'unit').click();
    await fixture.whenStable();
    const units = openOptions().map((o) => o.textContent?.trim());
    expect(units).toEqual(['Mililitros (ml)', 'Tazas']);
  });

  it('emite el borrador normalizado; acepta la coma decimal y la envía con punto', async () => {
    await fillValid();
    button('Agregar alimento').click();
    await fixture.whenStable();
    await fillItem(0, 1, 'Mantequilla de maní', '1,5');
    await submit();

    expect(reviewed).toEqual([
      {
        athleteEmail: 'deportista@example.com',
        title: 'Recuperación',
        objectives: ['Mejorar la recuperación'],
        startDate: '2026-11-02',
        endDate: '2026-11-29',
        meals: [
          {
            mealType: 'BREAKFAST',
            items: [
              { foodCode: 'OATS', quantity: '60', unit: 'G' },
              { foodCode: 'PEANUT_BUTTER', quantity: '1.5', unit: 'G' },
            ],
          },
        ],
      },
    ]);
    expect(edited).toBeGreaterThan(0);
  });

  it('valida solo el formato de la cantidad del contrato; el rango lo decide el backend', async () => {
    await fillValid();
    const quantity = input('[formcontrolname="quantity"]');

    type(quantity, '1.5.2');
    await submit();
    expect(reviewed).toEqual([]);
    expect(element.textContent).toContain('El formato no es válido.');

    type(quantity, '9999');
    await submit();
    expect(reviewed.length).toBe(1);
    expect(reviewed[0].meals[0].items[0].quantity).toBe('9999');
  });

  it('normaliza la cantidad sin espacios y con punto decimal', () => {
    expect(normalizeQuantity(' 2,5 ')).toBe('2.5');
    expect(normalizeQuantity('150')).toBe('150');
  });

  it('permite de 1 a 8 comidas y de 1 a 15 alimentos por comida (límites del contrato)', async () => {
    for (let i = 0; i < 7; i++) {
      button('Agregar comida').click();
      await fixture.whenStable();
    }
    expect(element.querySelectorAll('[data-meal]').length).toBe(8);
    expect(button('Agregar comida').disabled).toBeTrue();

    const addItem = element.querySelector<HTMLButtonElement>(
      '[aria-label="Agregar alimento a la comida 1"]',
    )!;
    for (let i = 0; i < 14; i++) {
      addItem.click();
      await fixture.whenStable();
    }
    expect(element.querySelectorAll('[data-meal="0"] [data-item]').length).toBe(15);
    expect(addItem.disabled).toBeTrue();
  });

  it('marca junto al ítem el bloqueo por alergia y por restricción, y los lista (CA2)', async () => {
    await fillValid();
    button('Agregar alimento').click();
    await fixture.whenStable();
    await fillItem(0, 1, 'Mantequilla de maní', '1.5');

    await setServerErrors({
      athleteNotAuthorized: false,
      violations: [
        { path: 'meals.0.items.1.food_code', issue: 'conflicts_with_allergy' },
        { path: 'meals.0.items.1.food_code', issue: 'conflicts_with_restriction' },
      ],
    });

    const summary = element.querySelector<HTMLElement>('[data-testid="nutrition-errors"]')!;
    expect(document.activeElement).toBe(summary);
    expect([...summary.querySelectorAll('li')].map((li) => li.textContent?.trim())).toEqual([
      'Comida 1, alimento 2: contiene un alérgeno que el deportista registró.',
      'Comida 1, alimento 2: no es compatible con una restricción alimentaria del deportista.',
    ]);
    const itemError = item(0, 1).querySelector('mat-error')!.textContent!;
    expect(itemError).toContain('contiene un alérgeno que el deportista registró.');
    expect(itemError).toContain('no es compatible con una restricción alimentaria del deportista.');
    expect(item(0, 0).querySelector('mat-error')).toBeNull();
  });

  it('al cambiar el alimento bloqueado se retira la marca del backend', async () => {
    await fillValid();
    await setServerErrors({
      athleteNotAuthorized: false,
      violations: [{ path: 'meals.0.items.0.food_code', issue: 'conflicts_with_allergy' }],
    });
    expect(item(0, 0).querySelector('mat-error')).not.toBeNull();

    await choose(select(item(0, 0), 'foodCode'), 'Banano');
    fixture.detectChanges();

    expect(item(0, 0).querySelector('mat-error')).toBeNull();
  });

  it('indica en el correo que el deportista no autorizó al profesional', async () => {
    await fillValid();
    await setServerErrors({ athleteNotAuthorized: true, violations: [] });

    expect(element.textContent).toContain('no corresponde a un deportista que te haya autorizado');
  });

  it('permite de 1 a 5 objetivos y quitar cualquiera mientras quede uno (límite del contrato)', async () => {
    for (let i = 0; i < 4; i++) {
      button('Agregar objetivo').click();
      await fixture.whenStable();
    }
    expect(element.querySelectorAll('[data-focus="objective"]').length).toBe(5);
    expect(button('Agregar objetivo').disabled).toBeTrue();
    await new Promise((resolve) => setTimeout(resolve));
    expect(document.activeElement).toBe(input('[data-focus="objective"]', 4));

    element.querySelector<HTMLButtonElement>('[aria-label="Quitar el objetivo 2"]')!.click();
    await fixture.whenStable();
    expect(element.querySelectorAll('[data-focus="objective"]').length).toBe(4);
  });

  it('quita una comida o un alimento sin bajar del mínimo', async () => {
    button('Agregar comida').click();
    await fixture.whenStable();
    element
      .querySelector<HTMLButtonElement>('[aria-label="Agregar alimento a la comida 2"]')!
      .click();
    await fixture.whenStable();
    expect(element.querySelectorAll('[data-meal="1"] [data-item]').length).toBe(2);

    element
      .querySelector<HTMLButtonElement>('[aria-label="Quitar el alimento 2 de la comida 2"]')!
      .click();
    await fixture.whenStable();
    expect(element.querySelectorAll('[data-meal="1"] [data-item]').length).toBe(1);

    element.querySelector<HTMLButtonElement>('[aria-label="Quitar la comida 2"]')!.click();
    await fixture.whenStable();
    expect(element.querySelectorAll('[data-meal]').length).toBe(1);
    expect(
      element.querySelector<HTMLButtonElement>('[aria-label="Quitar la comida 1"]')!.disabled,
    ).toBeTrue();
  });

  it('marca las reglas del plan, de un objetivo y del tipo de comida; las listas solo van al resumen', async () => {
    await fillValid();
    await setServerErrors({
      athleteNotAuthorized: false,
      violations: [
        { path: 'end_date', issue: 'period_too_long' },
        { path: 'objectives.0', issue: 'out_of_range' },
        { path: 'meals.0.meal_type', issue: 'unknown_value' },
        { path: 'meals.0.items.0.unit', issue: 'unit_not_allowed' },
        { path: 'meals', issue: 'out_of_range' },
        { path: 'meals.5.items.0.food_code', issue: 'unknown_value' },
      ],
    });

    const errors = [...element.querySelectorAll('mat-error')].map((e) => e.textContent!.trim());
    expect(errors).toEqual([
      'el periodo supera la duración máxima permitida.',
      'el valor está fuera del rango permitido.',
      'el valor no pertenece al catálogo.',
      'la unidad no está permitida para este alimento.',
    ]);
    expect(element.querySelectorAll('[data-testid="nutrition-errors"] li').length).toBe(6);
  });

  it('si el plan está incompleto lleva el foco al primer campo inválido', async () => {
    await submit();
    await new Promise((resolve) => setTimeout(resolve));

    expect(document.activeElement).toBe(input('[formcontrolname="athleteEmail"]'));
  });

  it('reset vuelve al formulario inicial', async () => {
    await fillValid();
    button('Agregar comida').click();
    await fixture.whenStable();

    fixture.componentInstance.reset();
    await fixture.whenStable();

    expect(element.querySelectorAll('[data-meal]').length).toBe(1);
    expect(input('[formcontrolname="title"]').value).toBe('');
    expect(element.querySelector('mat-error')).toBeNull();
  });
});
