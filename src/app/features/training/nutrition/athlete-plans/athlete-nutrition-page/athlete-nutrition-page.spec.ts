import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  FakeFoodIntakesGateway,
  TEST_INTAKES_EMPTY,
} from '../../../../../../testing/fake-food-intakes.gateway';
import { provideTranslateTesting } from '../../../../../../testing/translate-testing';
import { FoodIntakesGateway } from '../../intake-history/food-intakes.gateway';
import { NutritionPlan } from '../../nutrition-plan.model';
import { NutritionGateway } from '../../nutrition.gateway';
import { FakeNutritionGateway, TEST_PLAN } from '../../../../../../testing/fake-nutrition.gateway';
import { AthleteNutritionPage } from './athlete-nutrition-page';

// Datos sintéticos de prueba.
const OLDER: NutritionPlan = {
  ...TEST_PLAN,
  id: '4f6b8d0f-2c3e-4d5f-8a6b-9c1e3a5b7d9f',
  title: 'Base de pretemporada',
};

describe('AthleteNutritionPage (HU014)', () => {
  let fixture: ComponentFixture<AthleteNutritionPage>;
  let gateway: FakeNutritionGateway;
  let intakes: FakeFoodIntakesGateway;
  let element: HTMLElement;

  async function create(): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [AthleteNutritionPage],
      providers: [
        provideTranslateTesting(),
        { provide: NutritionGateway, useValue: gateway },
        { provide: FoodIntakesGateway, useValue: intakes },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AthleteNutritionPage);
    await fixture.whenStable();
    element = fixture.nativeElement as HTMLElement;
  }

  function testId(id: string): HTMLElement | null {
    return element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  }

  function titles(): string[] {
    return [...element.querySelectorAll('mat-panel-title')].map((t) => t.textContent!.trim());
  }

  function button(text: string): HTMLButtonElement | undefined {
    return [...element.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes(text),
    );
  }

  beforeEach(() => {
    gateway = new FakeNutritionGateway();
    intakes = new FakeFoodIntakesGateway();
  });

  it('muestra la sección «Planes de alimentación» con el estado confirmado (CA5)', async () => {
    await create();

    expect(element.querySelector('h1')?.textContent).toContain('Mi alimentación');
    expect(element.querySelector('h2')?.textContent).toContain('Planes de alimentación');
    expect(titles()).toEqual([TEST_PLAN.title]);
    expect(testId('athlete-nutrition-status')?.textContent?.trim()).toBe('Asignado');
    expect(element.textContent).toContain('Avena');
    expect(element.textContent).not.toMatch(/calor|kcal/i);
    expect(testId('athlete-nutrition-count')?.textContent).toContain('Planes mostrados: 1.');
  });

  it('sin planes muestra el estado vacío, no un error', async () => {
    gateway.loadMyPlans.and.resolveTo({ plans: [], nextCursor: null });
    await create();

    expect(testId('state-empty')?.textContent).toContain('Aún no tienes planes de alimentación');
  });

  it('un fallo no se interpreta como lista vacía y permite reintentar', async () => {
    gateway.loadMyPlans.and.rejectWith(new HttpErrorResponse({ status: 503 }));
    await create();

    expect(testId('state-error')).not.toBeNull();
    expect(testId('state-empty')).toBeNull();

    gateway.loadMyPlans.and.resolveTo({ plans: [TEST_PLAN], nextCursor: null });
    button('Reintentar')!.click();
    await fixture.whenStable();

    expect(titles()).toEqual([TEST_PLAN.title]);
  });

  it('un rol sin permiso ve el rechazo sin datos', async () => {
    gateway.loadMyPlans.and.rejectWith(
      new HttpErrorResponse({
        status: 403,
        error: { code: 'permission_required', message: 'x', correlation_id: null },
      }),
    );
    await create();

    expect(testId('state-error')?.textContent).toContain('No tienes permiso');
    expect(button('Reintentar')).toBeUndefined();
  });

  it('carga la página siguiente con el cursor sin modificar y conserva los planes', async () => {
    gateway.loadMyPlans.and.returnValues(
      Promise.resolve({ plans: [TEST_PLAN], nextCursor: 'cursor+opaco/=' }),
      Promise.resolve({ plans: [OLDER], nextCursor: null }),
    );
    await create();
    expect(testId('athlete-nutrition-count')?.textContent).toContain('Hay más disponibles');

    button('Cargar más')!.click();
    await fixture.whenStable();

    expect(gateway.loadMyPlans.calls.argsFor(1)).toEqual(['cursor+opaco/=']);
    expect(titles()).toEqual([TEST_PLAN.title, OLDER.title]);
    expect(button('Cargar más')).toBeUndefined();
  });

  it('si falla la página siguiente conserva los planes y ofrece reintentar', async () => {
    gateway.loadMyPlans.and.returnValues(
      Promise.resolve({ plans: [TEST_PLAN], nextCursor: 'c1' }),
      Promise.reject(new HttpErrorResponse({ status: 0 })),
    );
    await create();
    button('Cargar más')!.click();
    await fixture.whenStable();

    expect(titles()).toEqual([TEST_PLAN.title]);
    expect(testId('athlete-nutrition-more-error')?.textContent).toContain('No hay conexión');
    expect(button('Reintentar')).toBeDefined();
  });

  it('los planes se presentan como paneles expandibles accesibles por teclado', async () => {
    await create();

    const header = element.querySelector<HTMLElement>('mat-expansion-panel-header')!;
    expect(header.getAttribute('role')).toBe('button');
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(header.getAttribute('tabindex')).toBe('0');
  });

  describe('con la sección «Mis consumos» (HU013)', () => {
    it('muestra los consumos propios con los nombres del catálogo', async () => {
      await create();

      expect(intakes.loadPage).toHaveBeenCalledOnceWith(
        { kind: 'own' },
        { from: null, to: null, mealType: null },
        null,
      );
      expect(testId('food-intakes')?.querySelector('h2')?.textContent).toContain('Mis consumos');
      expect(testId('food-intakes-list')?.textContent).toContain('Huevo');
      expect(testId('athlete-nutrition-nothing-yet')).toBeNull();
    });

    it('sin consumos ni planes muestra un aviso explícito (CA5)', async () => {
      gateway.loadMyPlans.and.resolveTo({ plans: [], nextCursor: null });
      intakes.loadPage.and.resolveTo(TEST_INTAKES_EMPTY);
      await create();

      expect(testId('athlete-nutrition-nothing-yet')?.textContent).toContain(
        'Aún no tienes consumos registrados ni planes de alimentación',
      );
      expect(testId('food-intakes')?.textContent).toContain('Aún no tienes consumos registrados');
    });

    it('con planes pero sin consumos no muestra el aviso de CA5', async () => {
      intakes.loadPage.and.resolveTo(TEST_INTAKES_EMPTY);
      await create();

      expect(testId('athlete-nutrition-nothing-yet')).toBeNull();
      expect(titles()).toEqual([TEST_PLAN.title]);
    });

    it('si falla la consulta de planes no afirma que no hay nada', async () => {
      gateway.loadMyPlans.and.rejectWith(new HttpErrorResponse({ status: 503 }));
      intakes.loadPage.and.resolveTo(TEST_INTAKES_EMPTY);
      await create();

      expect(testId('athlete-nutrition-nothing-yet')).toBeNull();
    });
  });
});
