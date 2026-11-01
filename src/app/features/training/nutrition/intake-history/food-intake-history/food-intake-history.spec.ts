import { HttpErrorResponse } from '@angular/common/http';
import { LOCALE_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  FOOD_INTAKES_RESPONSES,
  SIMULATED_INTAKES_ATHLETE_ID,
} from '../../../../../../testing/bff-web/food-intakes.fixtures';
import {
  FakeFoodIntakesGateway,
  TEST_INTAKES_EMPTY,
  TEST_INTAKES_FIRST_PAGE,
  TEST_INTAKES_LAST_PAGE,
} from '../../../../../../testing/fake-food-intakes.gateway';
import { TEST_CATALOG } from '../../../../../../testing/fake-nutrition.gateway';
import { provideTranslateTesting } from '../../../../../../testing/translate-testing';
import { DEFAULT_LANGUAGE } from '../../../../../core/i18n/i18n.providers';
import { FoodCatalog } from '../../nutrition-plan.model';
import { FoodIntakesGateway } from '../food-intakes.gateway';
import { IntakeScope, toFoodIntakesPage } from '../food-intakes.model';
import { FoodIntakeHistory } from './food-intake-history';

function httpError(response: { status: number; body: unknown }): HttpErrorResponse {
  return new HttpErrorResponse({ status: response.status, error: response.body });
}

describe('FoodIntakeHistory (HU013)', () => {
  let fixture: ComponentFixture<FoodIntakeHistory>;
  let gateway: FakeFoodIntakesGateway;
  let element: HTMLElement;
  let emitted: boolean[];

  async function create(
    scope: IntakeScope = { kind: 'own' },
    catalog: FoodCatalog | null = TEST_CATALOG,
  ): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [FoodIntakeHistory],
      providers: [
        provideTranslateTesting(),
        { provide: LOCALE_ID, useValue: DEFAULT_LANGUAGE },
        { provide: FoodIntakesGateway, useValue: gateway },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(FoodIntakeHistory);
    fixture.componentRef.setInput('scope', scope);
    fixture.componentRef.setInput('catalog', catalog);
    emitted = [];
    fixture.componentInstance.unfilteredEmpty.subscribe((value) => emitted.push(value));
    await settle();
    element = fixture.nativeElement as HTMLElement;
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function testId(id: string): HTMLElement | null {
    return element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  }

  function button(text: string): HTMLButtonElement | undefined {
    return [...element.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes(text),
    );
  }

  function input(label: string): HTMLInputElement {
    const field = [...element.querySelectorAll('mat-form-field')].find((f) =>
      f.querySelector('mat-label')?.textContent?.includes(label),
    )!;
    return field.querySelector('input')!;
  }

  function type(target: HTMLInputElement, value: string): void {
    target.value = value;
    target.dispatchEvent(new Event('input'));
  }

  function intakeIds(): string[] {
    return [...element.querySelectorAll<HTMLElement>('[data-intake]')].map(
      (item) => item.dataset['intake']!,
    );
  }

  beforeEach(() => {
    gateway = new FakeFoodIntakesGateway();
  });

  it('CA1: muestra los consumos por día y comida, con alimento, cantidad y unidad', async () => {
    gateway.loadPage.and.resolveTo(TEST_INTAKES_FIRST_PAGE);
    await create();

    expect(gateway.loadPage).toHaveBeenCalledOnceWith(
      { kind: 'own' },
      { from: null, to: null, mealType: null },
      null,
    );
    expect(element.querySelector('h2')?.textContent).toContain('Mis consumos');
    // Mismo orden que el backend (`consumed_at` desc), sin reordenar.
    expect(intakeIds()).toEqual(TEST_INTAKES_FIRST_PAGE.intakes.map((intake) => intake.id));
    const list = testId('food-intakes-list')!;
    expect(list.querySelectorAll('[data-day]').length).toBeGreaterThan(0);
    expect(list.querySelector('h4')?.textContent).toContain('Cena');
    expect(list.textContent).toContain('Pechuga de pollo');
    expect(list.textContent).toContain('150 g');
    expect(list.textContent).toContain('1,5 cda.');
    expect(list.textContent).toContain('Consumido a las');
    expect(element.textContent).not.toMatch(/calor|kcal|nutrient/i);
    expect(testId('food-intakes-count')?.textContent).toContain('Hay más disponibles');
  });

  it('un alimento fuera del catálogo muestra su código en lugar de inventar un nombre', async () => {
    gateway.loadPage.and.resolveTo(toFoodIntakesPage(FOOD_INTAKES_RESPONSES.unknownFood.body));
    await create({ kind: 'own' }, TEST_CATALOG);

    expect(testId('food-intakes-list')?.textContent).toContain('COFFEE');
  });

  it('aplica los filtros de periodo y tipo de comida y vuelve a la primera página', async () => {
    await create();
    type(input('Desde'), '2026-10-01');
    type(input('Hasta'), '2026-10-24');
    fixture.componentInstance['form'].controls.mealType.setValue('LUNCH');
    button('Aplicar filtros')!.click();
    await settle();

    expect(gateway.loadPage.calls.mostRecent().args).toEqual([
      { kind: 'own' },
      { from: '2026-10-01', to: '2026-10-24', mealType: 'LUNCH' },
      null,
    ]);

    button('Limpiar filtros')!.click();
    await settle();
    expect(gateway.loadPage.calls.mostRecent().args[1]).toEqual({
      from: null,
      to: null,
      mealType: null,
    });
  });

  it('CA2: un periodo invertido se marca junto a «Hasta» sin consultar', async () => {
    await create();
    gateway.loadPage.calls.reset();
    type(input('Desde'), '2026-10-24');
    type(input('Hasta'), '2026-10-01');
    button('Aplicar filtros')!.click();
    await settle();

    expect(gateway.loadPage).not.toHaveBeenCalled();
    expect(testId('food-intakes-period-error')?.textContent).toContain(
      'no puede ser anterior a la fecha «Desde»',
    );
    expect(input('Hasta').getAttribute('aria-invalid')).toBe('true');
    expect(input('Hasta').getAttribute('aria-describedby')).toBe('food-intakes-period-error');
  });

  it('CA2: el 422 to_before_from del backend se explica junto al campo', async () => {
    gateway.loadPage.and.rejectWith(httpError(FOOD_INTAKES_RESPONSES.toBeforeFrom));
    await create();

    expect(testId('food-intakes-period-error')).not.toBeNull();
    expect(testId('state-error')?.textContent).toContain('Algunos datos no son válidos');
  });

  it('CA2: un cursor corrupto ofrece volver a cargar desde el inicio y conserva lo cargado', async () => {
    gateway.loadPage.and.returnValues(
      Promise.resolve(TEST_INTAKES_FIRST_PAGE),
      Promise.reject(httpError(FOOD_INTAKES_RESPONSES.invalidCursor)),
      Promise.resolve(TEST_INTAKES_FIRST_PAGE),
    );
    await create();
    button('Cargar más consumos')!.click();
    await settle();

    expect(intakeIds().length).toBe(TEST_INTAKES_FIRST_PAGE.intakes.length);
    expect(testId('food-intakes-more-error')?.textContent).toContain('No se pudo continuar');
    expect(testId('food-intakes-more-error')?.textContent).toContain('Código de referencia');

    button('Volver a cargar desde el inicio')!.click();
    await settle();
    expect(gateway.loadPage.calls.mostRecent().args[2]).toBeNull();
    expect(testId('food-intakes-more-error')).toBeNull();
  });

  it('CA3: sin autorización vigente lo explica sin datos ni reintento', async () => {
    gateway.loadPage.and.rejectWith(httpError(FOOD_INTAKES_RESPONSES.athleteAuthorizationRequired));
    await create({ kind: 'athlete', athleteId: SIMULATED_INTAKES_ATHLETE_ID });

    expect(testId('food-intakes-not-authorized')?.textContent).toContain(
      'No tienes una autorización vigente',
    );
    expect(testId('food-intakes-list')).toBeNull();
    expect(button('Reintentar')).toBeUndefined();
    expect(element.querySelector('h2')?.textContent).toContain('Consumos del deportista');
  });

  it('CA3: un rol sin permiso ve el rechazo, no una lista vacía', async () => {
    gateway.loadPage.and.rejectWith(httpError(FOOD_INTAKES_RESPONSES.permissionRequired));
    await create();

    expect(testId('state-error')?.textContent).toContain('No tienes permiso');
    expect(testId('state-empty')).toBeNull();
  });

  it('CA4: carga la página siguiente con el cursor sin modificar, la agrega y mueve el foco', async () => {
    gateway.loadPage.and.returnValues(
      Promise.resolve(TEST_INTAKES_FIRST_PAGE),
      Promise.resolve(TEST_INTAKES_LAST_PAGE),
    );
    await create();
    const before = intakeIds().length;
    button('Cargar más consumos')!.click();
    await settle();

    expect(gateway.loadPage.calls.argsFor(1)[2]).toBe(TEST_INTAKES_FIRST_PAGE.nextCursor);
    expect(intakeIds()).toEqual([
      ...TEST_INTAKES_FIRST_PAGE.intakes.map((intake) => intake.id),
      ...TEST_INTAKES_LAST_PAGE.intakes.map((intake) => intake.id),
    ]);
    expect(document.activeElement?.getAttribute('data-intake')).toBe(intakeIds()[before]);
    expect(button('Cargar más consumos')).toBeUndefined();
    expect(testId('food-intakes-count')?.textContent).toContain(
      `Consumos mostrados: ${intakeIds().length}.`,
    );
  });

  it('si falla la página siguiente conserva los consumos y ofrece reintentar', async () => {
    gateway.loadPage.and.returnValues(
      Promise.resolve(TEST_INTAKES_FIRST_PAGE),
      Promise.reject(new HttpErrorResponse({ status: 0 })),
    );
    await create();
    button('Cargar más consumos')!.click();
    await settle();

    expect(intakeIds().length).toBe(TEST_INTAKES_FIRST_PAGE.intakes.length);
    expect(testId('food-intakes-more-error')?.textContent).toContain('No hay conexión');
    expect(button('Reintentar')).toBeDefined();
  });

  it('CA5: sin consumos muestra un vacío explícito y lo informa a la página', async () => {
    gateway.loadPage.and.resolveTo(TEST_INTAKES_EMPTY);
    await create();

    expect(testId('state-empty')?.textContent).toContain('Aún no tienes consumos registrados');
    expect(emitted).toEqual([true]);
  });

  it('con filtros sin resultados usa otro mensaje y no informa el vacío sin filtros', async () => {
    gateway.loadPage.and.resolveTo(TEST_INTAKES_EMPTY);
    await create({ kind: 'athlete', athleteId: SIMULATED_INTAKES_ATHLETE_ID });
    expect(testId('state-empty')?.textContent).toContain('aún no tiene consumos registrados');

    fixture.componentInstance['form'].controls.mealType.setValue('SNACK');
    button('Aplicar filtros')!.click();
    await settle();

    expect(testId('state-empty')?.textContent).toContain('No hay consumos con estos filtros');
    expect(emitted).toEqual([true]);
  });

  it('un error del servicio no es una lista vacía y permite reintentar', async () => {
    gateway.loadPage.and.rejectWith(httpError(FOOD_INTAKES_RESPONSES.upstreamUnavailable));
    await create();

    expect(testId('state-error')).not.toBeNull();
    expect(testId('state-empty')).toBeNull();
    expect(emitted).toEqual([]);

    gateway.loadPage.and.resolveTo(TEST_INTAKES_LAST_PAGE);
    button('Reintentar')!.click();
    await settle();
    expect(intakeIds().length).toBe(TEST_INTAKES_LAST_PAGE.intakes.length);
  });

  it('el formulario de filtros y la lista son accesibles', async () => {
    gateway.loadPage.and.resolveTo(TEST_INTAKES_FIRST_PAGE);
    await create();

    const form = element.querySelector('form')!;
    expect(form.getAttribute('aria-label')).toBe('Filtros del historial de alimentación');
    expect(element.querySelector('section')?.getAttribute('aria-labelledby')).toBe(
      'food-intakes-title',
    );
    expect(testId('food-intakes-count')?.getAttribute('role')).toBe('status');
    expect(element.querySelector('[data-intake]')?.getAttribute('tabindex')).toBe('-1');
    expect(element.textContent).toContain('día del consumo en UTC');
  });
});
