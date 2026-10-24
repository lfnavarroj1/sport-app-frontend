import { LOCALE_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { MatCheckboxHarness } from '@angular/material/checkbox/testing';
import { MatSelectHarness } from '@angular/material/select/testing';

import {
  NUTRITION_HABITS_SECTION,
  SIMULATED_HEALTH_CONSENT_VERSION,
} from '../../../../../testing/bff-web/profile.fixtures';
import { provideTranslateTesting } from '../../../../../testing/translate-testing';
import { DEFAULT_LANGUAGE } from '../../../../core/i18n/i18n.providers';
import {
  NutritionHabits,
  NutritionHabitsDraft,
  ProfileViolation,
  toNutritionHabits,
} from '../profile.model';
import { NutritionHabitsForm } from './nutrition-habits-form';

// Datos sintéticos de prueba (ejemplo de ADR-035).
const INITIAL: NutritionHabits = toNutritionHabits(NUTRITION_HABITS_SECTION);
const CONSENT = 'Acepto que SportApp trate mis datos de salud';

describe('NutritionHabitsForm (HU009)', () => {
  let fixture: ComponentFixture<NutritionHabitsForm>;
  let element: HTMLElement;
  let loader: HarnessLoader;
  let submitted: NutritionHabitsDraft[];
  let edited: number;
  let cancelled: number;

  async function create(initial: NutritionHabits | null = null): Promise<void> {
    fixture = TestBed.createComponent(NutritionHabitsForm);
    fixture.componentRef.setInput('initial', initial);
    fixture.componentRef.setInput('consentVersion', SIMULATED_HEALTH_CONSENT_VERSION);
    submitted = [];
    edited = 0;
    cancelled = 0;
    fixture.componentInstance.submitted.subscribe((draft) => submitted.push(draft));
    fixture.componentInstance.edited.subscribe(() => edited++);
    fixture.componentInstance.cancelled.subscribe(() => cancelled++);
    loader = TestbedHarnessEnvironment.loader(fixture);
    await fixture.whenStable();
    element = fixture.nativeElement as HTMLElement;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NutritionHabitsForm],
      providers: [provideTranslateTesting(), { provide: LOCALE_ID, useValue: DEFAULT_LANGUAGE }],
    }).compileComponents();
  });

  function testId(id: string): HTMLElement | null {
    return element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  }

  async function choose(name: string, option: string): Promise<void> {
    const select = await loader.getHarness(
      MatSelectHarness.with({ selector: `[formcontrolname="${name}"]` }),
    );
    await select.open();
    await select.clickOptions({ text: option });
  }

  async function check(label: string | RegExp): Promise<void> {
    await (await loader.getHarness(MatCheckboxHarness.with({ label }))).toggle();
  }

  async function isChecked(label: string): Promise<boolean> {
    return (await loader.getHarness(MatCheckboxHarness.with({ label }))).isChecked();
  }

  function hydration(): HTMLInputElement {
    return element.querySelector<HTMLInputElement>('[formcontrolname="hydration"]')!;
  }

  async function typeHydration(value: string): Promise<void> {
    hydration().value = value;
    hydration().dispatchEvent(new Event('input'));
    hydration().dispatchEvent(new Event('blur'));
    await fixture.whenStable();
  }

  function saveButton(): HTMLButtonElement {
    return [...element.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes('Guardar hábitos alimenticios'),
    )!;
  }

  async function submit(): Promise<void> {
    element.querySelector('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
  }

  async function fillRequired(): Promise<void> {
    await choose('dietPattern', 'Vegetariano');
    await choose('mealsPerDay', '4');
  }

  async function setServerErrors(violations: readonly ProfileViolation[]): Promise<void> {
    fixture.componentRef.setInput('serverErrors', violations);
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  }

  it('ofrece solo catálogos cerrados, sin texto libre salvo la hidratación decimal', async () => {
    await create();

    const pattern = await loader.getHarness(
      MatSelectHarness.with({ selector: '[formcontrolname="dietPattern"]' }),
    );
    await pattern.open();
    expect(await Promise.all((await pattern.getOptions()).map((o) => o.getText()))).toEqual([
      'Omnívoro',
      'Vegetariano',
      'Vegano',
      'Pescetariano',
      'Flexitariano',
    ]);
    await pattern.close();
    const meals = await loader.getHarness(
      MatSelectHarness.with({ selector: '[formcontrolname="mealsPerDay"]' }),
    );
    await meals.open();
    expect((await meals.getOptions()).length).toBe(8);
    await meals.close();
    expect(testId('nutrition-habits-restrictions')!.querySelectorAll('mat-checkbox').length).toBe(
      7,
    );
    expect(testId('nutrition-habits-allergies')!.querySelectorAll('mat-checkbox').length).toBe(9);
    expect(element.querySelectorAll('input[type="text"]').length).toBe(1);
    expect(element.querySelector('textarea')).toBeNull();
    expect(testId('nutrition-habits-disclaimer')?.textContent).toContain(
      'ni sustituye la valoración de un profesional de la salud',
    );
  });

  it('«Guardar» está deshabilitado sin el consentimiento, que nunca viene marcado', async () => {
    await create(INITIAL);

    expect(
      await isChecked(
        `${CONSENT}, incluidas mis restricciones y alergias alimentarias, para personalizar mi experiencia (versión ${SIMULATED_HEALTH_CONSENT_VERSION}).`,
      ),
    ).toBeFalse();
    expect(saveButton().disabled).toBeTrue();
    expect(saveButton().getAttribute('aria-describedby')).toBe('nutrition-habits-consent-required');
    expect(testId('nutrition-habits-consent-required')?.textContent).toContain(
      'Marca la casilla de consentimiento',
    );

    await check(new RegExp(CONSENT));
    expect(saveButton().disabled).toBeFalse();
    expect(testId('nutrition-habits-consent-required')).toBeNull();
  });

  it('CA1: envía el borrador con las listas en el orden del catálogo y la hidratación con punto', async () => {
    await create();
    await fillRequired();
    await check('Bajo en azúcar');
    await check('Sin lactosa');
    await check('Mariscos');
    await check('Maní');
    await typeHydration('2,5');
    await check(new RegExp(CONSENT));
    await submit();

    expect(submitted).toEqual([
      {
        consentVersion: SIMULATED_HEALTH_CONSENT_VERSION,
        dietPattern: 'VEGETARIAN',
        restrictions: ['LACTOSE_FREE', 'LOW_SUGAR'],
        allergies: ['PEANUTS', 'SHELLFISH'],
        mealsPerDay: 4,
        hydrationLitersPerDay: '2.5',
      },
    ]);
  });

  it('restricciones, alergias e hidratación son opcionales', async () => {
    await create();
    await fillRequired();
    await check(new RegExp(CONSENT));
    await submit();

    expect(submitted[0]).toEqual(
      jasmine.objectContaining({ restrictions: [], allergies: [], hydrationLitersPerDay: null }),
    );
  });

  it('exige patrón y comidas por día y no envía sin ellos', async () => {
    await create();
    await check(new RegExp(CONSENT));
    await submit();

    expect(submitted).toEqual([]);
    const errors = [...element.querySelectorAll('mat-error')].map((e) => e.textContent?.trim());
    expect(errors.filter((text) => text === 'Este campo es obligatorio.').length).toBe(2);
  });

  it('valida el formato y el rango de la hidratación del contrato', async () => {
    await create();
    await fillRequired();
    await check(new RegExp(CONSENT));

    await typeHydration('2,55');
    await submit();
    expect(submitted).toEqual([]);
    expect(hydration().closest('mat-form-field')?.textContent).toContain('un decimal como máximo');

    await typeHydration('10,5');
    await submit();
    expect(submitted).toEqual([]);
    expect(hydration().closest('mat-form-field')?.textContent).toContain('entre 0,5 y 10,0');

    await typeHydration('10');
    await submit();
    expect(submitted[0].hydrationLitersPerDay).toBe('10');
  });

  it('al reemplazar parte de los valores confirmados sin contarlo como edición', async () => {
    await create(INITIAL);

    expect(await isChecked('Sin lactosa')).toBeTrue();
    expect(await isChecked('Maní')).toBeTrue();
    expect(await isChecked('Kosher')).toBeFalse();
    expect(hydration().value).toBe('2,5');
    expect(edited).toBe(0);

    await check('Kosher');
    expect(edited).toBeGreaterThan(0);
    await check(new RegExp(CONSENT));
    await submit();
    expect(submitted[0]).toEqual(
      jasmine.objectContaining({
        dietPattern: 'VEGETARIAN',
        restrictions: ['LACTOSE_FREE', 'LOW_SUGAR', 'KOSHER'],
        mealsPerDay: 4,
        hydrationLitersPerDay: '2.5',
      }),
    );
  });

  it('CA2: marca las reglas del backend por campo, las resume y lleva el foco al resumen', async () => {
    await create(INITIAL);
    await setServerErrors([
      { field: 'allergies[1]', issue: 'duplicate_value' },
      { field: 'meals_per_day', issue: 'out_of_range' },
      { field: 'consent.version', issue: 'unsupported_consent_version' },
      { field: 'user_id', issue: 'field_not_allowed' },
    ]);

    const summary = testId('nutrition-habits-errors')!;
    expect(summary.getAttribute('role')).toBe('alert');
    expect(document.activeElement).toBe(summary);
    expect([...summary.querySelectorAll('li')].map((li) => li.textContent?.trim())).toEqual([
      'Alergias alimentarias: Hay valores repetidos.',
      'Comidas por día: El valor está fuera del rango permitido.',
      'Consentimiento de datos de salud: La versión del consentimiento ya no está vigente. Recarga la página y acepta la versión actual para guardar.',
      'Solicitud: Este dato no se puede enviar.',
    ]);
    expect(testId('nutrition-habits-allergies-error')?.textContent).toContain(
      'Hay valores repetidos.',
    );
    expect(testId('nutrition-habits-consent-error')?.textContent).toContain('ya no está vigente');

    // Al editar se retiran las marcas; el resumen sigue hasta el siguiente envío.
    await check('Huevo');
    fixture.detectChanges();
    expect(testId('nutrition-habits-allergies-error')).toBeNull();
    expect(testId('nutrition-habits-errors')).not.toBeNull();
  });

  it('no envía mientras se guarda y «Cancelar» avisa sin enviar', async () => {
    await create(INITIAL);
    await check(new RegExp(CONSENT));
    fixture.componentRef.setInput('submitting', true);
    await fixture.whenStable();

    expect(saveButton().disabled).toBeTrue();
    await submit();
    expect(submitted).toEqual([]);

    fixture.componentRef.setInput('submitting', false);
    await fixture.whenStable();
    [...element.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent?.trim() === 'Cancelar')!
      .click();
    expect(cancelled).toBe(1);
    expect(submitted).toEqual([]);
  });
});
