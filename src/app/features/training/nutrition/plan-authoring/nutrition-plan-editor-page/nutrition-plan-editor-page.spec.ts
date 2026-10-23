import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { provideTranslateTesting } from '../../../../../../testing/translate-testing';
import { ApiError } from '../../../../../core/api/api-error';
import { NutritionGateway } from '../../nutrition.gateway';
import {
  FakeNutritionGateway,
  TEST_CATALOG,
  TEST_DRAFT,
  TEST_PLAN,
} from '../../../../../../testing/fake-nutrition.gateway';
import { NutritionPlanForm } from '../nutrition-plan-form/nutrition-plan-form';
import { NutritionPlanEditorPage } from './nutrition-plan-editor-page';

const UNAVAILABLE: ApiError = {
  kind: 'server',
  status: 503,
  code: 'upstream_unavailable',
  correlationId: 'ref-sintetica-1',
};

describe('NutritionPlanEditorPage (HU014)', () => {
  let fixture: ComponentFixture<NutritionPlanEditorPage>;
  let gateway: FakeNutritionGateway;
  let element: HTMLElement;

  async function create(): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [NutritionPlanEditorPage],
      providers: [
        provideRouter([]),
        provideTranslateTesting(),
        { provide: NutritionGateway, useValue: gateway },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(NutritionPlanEditorPage);
    await fixture.whenStable();
    element = fixture.nativeElement as HTMLElement;
  }

  function form(): NutritionPlanForm {
    return fixture.debugElement.query((el) => el.componentInstance instanceof NutritionPlanForm)
      .componentInstance as NutritionPlanForm;
  }

  async function review(): Promise<void> {
    form().reviewed.emit(TEST_DRAFT);
    await fixture.whenStable();
  }

  function button(text: string): HTMLButtonElement | undefined {
    return [...element.querySelectorAll<HTMLButtonElement>('button, a')].find((b) =>
      b.textContent?.includes(text),
    ) as HTMLButtonElement | undefined;
  }

  async function confirm(): Promise<void> {
    button('Confirmar y asignar')!.click();
    await fixture.whenStable();
  }

  function keysUsed(): string[] {
    return gateway.createPlan.calls.allArgs().map(([, key]) => key as string);
  }

  function testId(id: string): HTMLElement | null {
    return element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  }

  beforeEach(() => {
    gateway = new FakeNutritionGateway();
  });

  describe('con el catálogo disponible', () => {
    beforeEach(create);

    it('muestra el editor con el catálogo cargado', () => {
      expect(element.querySelector('h1')?.textContent).toContain('Crear plan de alimentación');
      expect(gateway.loadCatalog).toHaveBeenCalledTimes(1);
      expect(element.querySelector('app-nutrition-plan-form')).not.toBeNull();
      expect(testId('nutrition-review')).toBeNull();
    });

    it('pide confirmar la asignación antes de enviar nada al BFF', async () => {
      await review();

      expect(gateway.createPlan).not.toHaveBeenCalled();
      expect(testId('nutrition-review-athlete')?.textContent).toBe('deportista@example.com');
      expect(document.activeElement?.textContent).toContain('Confirma la asignación');
    });

    it('presenta el plan asignado solo con la respuesta del backend (CA1)', async () => {
      await review();
      await confirm();

      const created = testId('nutrition-created')!;
      expect(created.textContent).toContain('Plan asignado');
      expect(created.textContent).toContain('Asignado');
      expect(created.textContent).toContain('Avena');
      expect(testId('nutrition-warning-habits')).toBeNull();
      expect(keysUsed()[0]).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('muestra el aviso de hábitos ausentes junto al plan creado (CA6)', async () => {
      gateway.createPlan.and.resolveTo({
        kind: 'created',
        plan: TEST_PLAN,
        warnings: ['nutrition_habits_missing'],
        replayed: false,
      });
      await review();
      await confirm();

      expect(testId('nutrition-warning-habits')?.textContent).toContain(
        'el plan se creó sin poder validar alergias ni restricciones',
      );
    });

    it('si Usuarios no responde informa que el plan no se guardó y reintenta con la misma clave (CA6)', async () => {
      gateway.createPlan.and.resolveTo({ kind: 'failed', error: UNAVAILABLE });
      await review();
      await confirm();

      const error = testId('nutrition-error')!;
      expect(error.getAttribute('role')).toBe('alert');
      expect(error.textContent).toContain('El plan no se guardó.');
      expect(error.textContent).toContain('ref-sintetica-1');
      expect(testId('nutrition-created')).toBeNull();

      gateway.createPlan.and.resolveTo({
        kind: 'created',
        plan: TEST_PLAN,
        warnings: [],
        replayed: true,
      });
      await confirm();

      expect(keysUsed()[1]).toBe(keysUsed()[0]);
      expect(testId('nutrition-replayed')).not.toBeNull();
    });

    it('un plan bloqueado vuelve al editor con los ítems marcados y nada guardado (CA2)', async () => {
      gateway.createPlan.and.resolveTo({
        kind: 'invalid',
        violations: [{ path: 'meals.0.items.1.food_code', issue: 'conflicts_with_allergy' }],
      });
      await review();
      await confirm();
      await new Promise((resolve) => setTimeout(resolve));
      fixture.detectChanges();

      expect(testId('nutrition-errors')?.textContent).toContain(
        'Comida 1, alimento 2: contiene un alérgeno que el deportista registró.',
      );
      expect(testId('nutrition-created')).toBeNull();
    });

    it('sin permiso se informa sin crear nada (CA3)', async () => {
      gateway.createPlan.and.resolveTo({
        kind: 'failed',
        error: { kind: 'forbidden', status: 403, code: 'permission_required', correlationId: null },
      });
      await review();
      await confirm();

      expect(testId('nutrition-error')?.textContent).toContain(
        'No tienes permiso para realizar esta acción.',
      );
    });

    it('el deportista sin autorización vuelve al editor con el correo marcado (CA3)', async () => {
      gateway.createPlan.and.resolveTo({ kind: 'athlete_not_authorized' });
      await review();
      await confirm();
      await new Promise((resolve) => setTimeout(resolve));
      fixture.detectChanges();

      expect(testId('nutrition-review')).toBeNull();
      expect(element.textContent).toContain(
        'no corresponde a un deportista que te haya autorizado',
      );
    });

    it('una clave reutilizada pide revisar y confirmar de nuevo con otra clave', async () => {
      gateway.createPlan.and.resolveTo({
        kind: 'failed',
        error: {
          kind: 'conflict',
          status: 409,
          code: 'idempotency_key_reused',
          correlationId: null,
        },
      });
      await review();
      await confirm();
      expect(testId('nutrition-error')?.textContent).toContain('No pudimos confirmar este intento');

      await confirm();
      expect(keysUsed()[1]).not.toBe(keysUsed()[0]);
    });

    it('un fallo inesperado del puerto se informa como error, nunca como éxito', async () => {
      gateway.createPlan.and.rejectWith(new Error('fallo sintético'));
      await review();
      await confirm();

      expect(testId('nutrition-error')?.textContent).toContain('Ocurrió un error inesperado.');
      expect(testId('nutrition-created')).toBeNull();
    });

    it('al editar los datos se usa una clave nueva', async () => {
      gateway.createPlan.and.resolveTo({ kind: 'failed', error: UNAVAILABLE });
      await review();
      await confirm();
      button('Volver a editar')!.click();
      await fixture.whenStable();
      form().edited.emit();
      await review();
      await confirm();

      expect(keysUsed()[1]).not.toBe(keysUsed()[0]);
    });

    it('evita el doble envío mientras confirma', async () => {
      let resolve!: (value: unknown) => void;
      gateway.createPlan.and.returnValue(new Promise((r) => (resolve = r)));
      await review();
      button('Confirmar y asignar')!.click();
      fixture.detectChanges();

      expect(button('Asignando…')!.disabled).toBeTrue();
      button('Asignando…')!.click();
      expect(gateway.createPlan).toHaveBeenCalledTimes(1);
      resolve({ kind: 'created', plan: TEST_PLAN, warnings: [], replayed: false });
      await fixture.whenStable();
    });

    it('permite crear otro plan después de asignar', async () => {
      await review();
      await confirm();
      button('Crear otro plan')!.click();
      await fixture.whenStable();

      expect(testId('nutrition-created')).toBeNull();
      expect(document.activeElement?.textContent).toContain('Datos del plan');
    });
  });

  it('si el catálogo falla no muestra el editor y permite reintentar', async () => {
    gateway.loadCatalog.and.rejectWith(new HttpErrorResponse({ status: 503 }));
    await create();

    expect(element.querySelector('app-nutrition-plan-form')).toBeNull();
    expect(testId('state-error')).not.toBeNull();

    gateway.loadCatalog.and.resolveTo(TEST_CATALOG);
    button('Reintentar')!.click();
    await fixture.whenStable();

    expect(element.querySelector('app-nutrition-plan-form')).not.toBeNull();
  });
});
