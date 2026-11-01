import { HttpErrorResponse } from '@angular/common/http';
import { LOCALE_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  MY_ROUTINES_RESPONSES,
  ROUTINES_NEXT_CURSOR,
  SIMULATED_ROUTINES_CORRELATION_ID,
  VALID_PUBLISH_ROUTINE_REQUEST,
  professionalRoutine,
} from '../../../../../../testing/bff-web/nutrition-routines.fixtures';
import { provideTranslateTesting } from '../../../../../../testing/translate-testing';
import { toApiError } from '../../../../../core/api/api-error';
import { DEFAULT_LANGUAGE } from '../../../../../core/i18n/i18n.providers';
import { SIMULATED_FOOD_CATALOG } from '../../../../../../testing/bff-web/nutrition.fixtures';
import { FoodCatalog, toFoodCatalog } from '../../nutrition-plan.model';
import { NutritionGateway } from '../../nutrition.gateway';
import { RoutineForm } from '../routine-form/routine-form';
import { RoutinesGateway } from '../routines.gateway';
import {
  NutritionRoutine,
  PublishOutcome,
  RetireOutcome,
  RoutineDraft,
  RoutinesPage as Page,
  toNutritionRoutine,
} from '../routines.model';
import { RoutinesPage } from './routines-page';

// Datos sintéticos derivados de los fixtures del contrato bff-web 0.34.0.
const FIRST: Page = {
  routines: MY_ROUTINES_RESPONSES.firstPage.body.items.map(toNutritionRoutine),
  nextCursor: ROUTINES_NEXT_CURSOR,
};
const LAST: Page = {
  routines: MY_ROUTINES_RESPONSES.lastPage.body.items.map(toNutritionRoutine),
  nextCursor: null,
};
const ROUTINE: NutritionRoutine = toNutritionRoutine(professionalRoutine(0));
const RETIRED: NutritionRoutine = toNutritionRoutine(professionalRoutine(0, 'RETIRED'));
const NEW_ROUTINE: NutritionRoutine = {
  ...ROUTINE,
  id: 'nueva-rutina',
  title: 'Rutina nueva',
};
const DRAFT: RoutineDraft = {
  title: VALID_PUBLISH_ROUTINE_REQUEST.title,
  description: VALID_PUBLISH_ROUTINE_REQUEST.description,
  goal: 'PERFORMANCE',
  sport: 'running',
  dietaryPattern: 'VEGETARIAN',
  containsAllergens: ['MILK'],
  durationDays: 14,
  dailyMeals: [{ meal: 'BREAKFAST', items: [{ foodCode: 'OATS', portions: 2 }] }],
};
const CATALOG: FoodCatalog = toFoodCatalog(SIMULATED_FOOD_CATALOG);
const SPACES = /\s+/g;

function failed(
  status: number,
  code: string,
): { kind: 'failed'; error: ReturnType<typeof toApiError> } {
  return {
    kind: 'failed',
    error: toApiError(
      new HttpErrorResponse({
        status,
        error: {
          code,
          message: 'x',
          correlation_id: SIMULATED_ROUTINES_CORRELATION_ID,
          details: [],
        },
      }),
    ),
  };
}

describe('RoutinesPage (HU030)', () => {
  let fixture: ComponentFixture<RoutinesPage>;
  let element: HTMLElement;
  let loadRoutines: jasmine.Spy;
  let publish: jasmine.Spy;
  let retire: jasmine.Spy;
  let loadCatalog: jasmine.Spy;

  async function create(): Promise<void> {
    fixture = TestBed.createComponent(RoutinesPage);
    element = fixture.nativeElement as HTMLElement;
    await settle();
  }

  async function settle(): Promise<void> {
    for (let round = 0; round < 3; round++) {
      await fixture.whenStable();
      await new Promise((resolve) => setTimeout(resolve));
    }
    fixture.detectChanges();
  }

  const byTestId = (id: string) => element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const text = (id: string) => byTestId(id)?.textContent?.replace(SPACES, ' ').trim() ?? '';
  const items = () => [...element.querySelectorAll<HTMLElement>('li[data-routine]')];
  const item = (id: string) => element.querySelector<HTMLElement>(`li[data-routine="${id}"]`)!;

  function button(label: string, scope: ParentNode = element): HTMLButtonElement | undefined {
    return [...scope.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.trim() === label,
    );
  }

  async function click(label: string, scope?: ParentNode): Promise<void> {
    const target = button(label, scope);
    expect(target).withContext(label).toBeDefined();
    target!.click();
    await settle();
  }

  function form(): RoutineForm {
    return fixture.debugElement.query((el) => el.componentInstance instanceof RoutineForm)
      .componentInstance as RoutineForm;
  }

  async function submit(draft: RoutineDraft = DRAFT): Promise<void> {
    form().submitted.emit(draft);
    await settle();
  }

  function keys(): string[] {
    return publish.calls.allArgs().map(([, key]) => key as string);
  }

  beforeEach(async () => {
    loadRoutines = jasmine.createSpy('loadRoutines').and.resolveTo(FIRST);
    publish = jasmine.createSpy('publish').and.resolveTo({
      kind: 'published',
      routine: NEW_ROUTINE,
      replayed: false,
    } satisfies PublishOutcome);
    retire = jasmine
      .createSpy('retire')
      .and.resolveTo({ kind: 'retired', routine: RETIRED } satisfies RetireOutcome);
    loadCatalog = jasmine.createSpy('loadCatalog').and.resolveTo(CATALOG);
    await TestBed.configureTestingModule({
      imports: [RoutinesPage],
      providers: [
        provideTranslateTesting(),
        { provide: LOCALE_ID, useValue: DEFAULT_LANGUAGE },
        { provide: RoutinesGateway, useValue: { loadRoutines, publish, retire } },
        { provide: NutritionGateway, useValue: { loadCatalog } },
      ],
    }).compileComponents();
  });

  it('muestra la carga mientras consulta las rutinas', async () => {
    loadRoutines.and.returnValue(new Promise(() => undefined));
    await create();

    expect(element.querySelector('h1')?.textContent).toContain('Rutinas de alimentación');
    expect(byTestId('state-loading')).not.toBeNull();
  });

  it('CA2 y CA4: lista las rutinas propias con alérgenos confirmados, vigencia y comidas, y pagina', async () => {
    await create();

    expect(items().length).toBe(20);
    const first = item(ROUTINE.id);
    expect(first.querySelector('h3')?.textContent).toContain(VALID_PUBLISH_ROUTINE_REQUEST.title);
    expect(first.textContent).toContain('Publicada');
    expect(first.textContent).toContain('Rutina vegetariana con carbohidratos');
    expect(first.textContent).toContain('Rendimiento');
    expect(first.textContent).toContain('Carrera');
    expect(first.textContent).toContain('Vegetariano');
    expect(text('routine-allergens-list')).toBe('Maní, Leche');
    expect(first.querySelector('[data-testid="routine-days"]')?.textContent?.trim()).toBe(
      '14 días',
    );
    const meals = first.querySelector('[data-testid="routine-meals-list"]')!;
    expect(meals.textContent?.replace(SPACES, ' ')).toContain('2 comidas · 3 alimentos');
    expect(
      [...meals.querySelectorAll('li')].map((li) => li.textContent?.replace(SPACES, ' ').trim()),
    ).toEqual(['Desayuno: Avena ×2, Mantequilla de maní ×1', 'Hidratación: Agua ×4']);
    const second = item(FIRST.routines[1].id);
    expect(second.textContent).toContain('Sin deporte específico');
    expect(second.textContent).toContain('Ninguno declarado');

    loadRoutines.and.resolveTo(LAST);
    await click('Cargar más');
    expect(loadRoutines.calls.mostRecent().args).toEqual([ROUTINES_NEXT_CURSOR]);
    expect(items().length).toBe(22);
    expect(items()[21].textContent).toContain('Retirada');
    expect(items()[21].querySelector('[data-testid="routine-retired-at"]')).not.toBeNull();
    expect(button('Retirar', items()[21])).toBeUndefined();
    expect(byTestId('routines-load-more')).toBeNull();
  });

  it('sin rutinas lo explica y un error se muestra con referencia y reintento', async () => {
    loadRoutines.and.resolveTo({ routines: [], nextCursor: null });
    await create();
    expect(byTestId('state-empty')?.textContent).toContain('Aún no has publicado rutinas.');

    loadRoutines.and.rejectWith(
      new HttpErrorResponse({
        status: 503,
        error: MY_ROUTINES_RESPONSES.upstreamUnavailable.body,
      }),
    );
    await create();
    expect(byTestId('state-error')?.textContent).toContain(SIMULATED_ROUTINES_CORRELATION_ID);
  });

  it('mientras carga más deshabilita el botón y un fallo con referencia la muestra', async () => {
    await create();
    let fail!: (error: unknown) => void;
    loadRoutines.and.returnValue(new Promise((_resolve, reject) => (fail = reject)));
    button('Cargar más')!.click();
    await settle();

    expect(button('Cargando…')?.disabled).toBeTrue();
    fail(
      new HttpErrorResponse({
        status: 503,
        error: MY_ROUTINES_RESPONSES.upstreamUnavailable.body,
      }),
    );
    await settle();
    expect(text('routines-more-error')).toContain(SIMULATED_ROUTINES_CORRELATION_ID);
  });

  it('un fallo al cargar más conserva lo mostrado', async () => {
    await create();
    loadRoutines.and.rejectWith(new HttpErrorResponse({ status: 0 }));
    await click('Cargar más');

    expect(text('routines-more-error')).toContain('No pudimos cargar más rutinas');
    expect(items().length).toBe(20);
  });

  describe('publicar', () => {
    it('CA4: publica con una clave por intento, muestra lo confirmado y lo agrega primero', async () => {
      await create();
      await click('Publicar una rutina');
      await submit();

      expect(publish).toHaveBeenCalledOnceWith(
        DRAFT,
        jasmine.stringMatching(/^[0-9a-f-]{36}$/),
        jasmine.any(Function),
      );
      const message = byTestId('routine-published')!;
      expect(message.getAttribute('role')).toBe('status');
      expect(message.textContent).toContain('Publicamos la rutina «Rutina nueva».');
      expect(document.activeElement).toBe(message);
      expect(items()[0].dataset['routine']).toBe('nueva-rutina');
      expect(byTestId('routine-form')).toBeNull();
    });

    it('CA4: informa que la confirmación corresponde a un envío anterior', async () => {
      publish.and.resolveTo({ kind: 'published', routine: ROUTINE, replayed: true });
      await create();
      await click('Publicar una rutina');
      await submit();

      expect(byTestId('routine-published-replayed')).not.toBeNull();
      // La rutina ya estaba en la lista: no se duplica.
      expect(items().filter((li) => li.dataset['routine'] === ROUTINE.id).length).toBe(1);
    });

    it('CA4: entrega al formulario las reglas del backend y nada se publica', async () => {
      const violations = [{ field: 'duration_weeks', issue: 'out_of_range' }];
      publish.and.resolveTo({ kind: 'invalid', violations });
      await create();
      await click('Publicar una rutina');
      await submit();

      expect(form().serverErrors()).toEqual(violations);
      expect(byTestId('routine-published')).toBeNull();
      expect(items().length).toBe(20);
      // Sin editar, volver a enviar es el mismo intento lógico.
      await submit();
      expect(keys()[1]).toBe(keys()[0]);
    });

    it('tras un fallo recuperable, reintentar usa la misma clave; editar la renueva', async () => {
      publish.and.resolveTo(failed(503, 'upstream_unavailable'));
      await create();
      await click('Publicar una rutina');
      await submit();

      const error = byTestId('routine-publish-error')!;
      expect(error.getAttribute('role')).toBe('alert');
      expect(error.textContent).toContain('no se publicará una rutina duplicada');
      expect(error.textContent).toContain(SIMULATED_ROUTINES_CORRELATION_ID);
      await submit();
      expect(keys()[1]).toBe(keys()[0]);
      form().edited.emit();
      await submit();
      expect(keys()[2]).not.toBe(keys()[1]);
    });

    it('idempotency_key_reused se explica y renueva la clave; el permiso denegado se informa', async () => {
      publish.and.resolveTo(failed(409, 'idempotency_key_reused'));
      await create();
      await click('Publicar una rutina');
      await submit();
      expect(text('routine-publish-error')).toContain('No pudimos confirmar la publicación');
      await submit();
      expect(keys()[1]).not.toBe(keys()[0]);

      publish.and.resolveTo(failed(403, 'permission_required'));
      await submit();
      expect(text('routine-publish-error')).toContain('No tienes permiso');
    });

    it('avisa los reintentos automáticos y no envía dos veces', async () => {
      let finish!: (outcome: PublishOutcome) => void;
      publish.and.callFake((_draft: RoutineDraft, _key: string, onRetry: (n: number) => void) => {
        onRetry(2);
        return new Promise<PublishOutcome>((resolve) => (finish = resolve));
      });
      await create();
      await click('Publicar una rutina');
      form().submitted.emit(DRAFT);
      form().submitted.emit(DRAFT);
      await settle();

      expect(publish).toHaveBeenCalledTimes(1);
      expect(text('routine-retrying')).toContain('Reintentando publicar la rutina (2 de 3)');
      finish({ kind: 'published', routine: NEW_ROUTINE, replayed: false });
      await settle();
      expect(byTestId('routine-published')).not.toBeNull();
    });

    it('un fallo sin conexión se informa sin código de referencia', async () => {
      publish.and.resolveTo({
        kind: 'failed',
        error: toApiError(new HttpErrorResponse({ status: 0 })),
      } satisfies PublishOutcome);
      await create();
      await click('Publicar una rutina');
      await submit();

      expect(text('routine-publish-error')).toContain('No hay conexión');
      expect(text('routine-publish-error')).not.toContain('Código de referencia');
    });

    it('si la página se cierra mientras publica, ignora el resultado', async () => {
      let finish!: (outcome: PublishOutcome) => void;
      publish.and.returnValue(new Promise<PublishOutcome>((resolve) => (finish = resolve)));
      await create();
      await click('Publicar una rutina');
      form().submitted.emit(DRAFT);
      await settle();
      fixture.destroy();
      finish({ kind: 'published', routine: NEW_ROUTINE, replayed: false });
      await new Promise((resolve) => setTimeout(resolve));

      expect(publish).toHaveBeenCalledTimes(1);
    });

    it('cancelar cierra el formulario sin publicar', async () => {
      await create();
      await click('Publicar una rutina');
      form().cancelled.emit();
      await settle();

      expect(byTestId('routine-form')).toBeNull();
      expect(publish).not.toHaveBeenCalled();
    });
  });

  describe('retirar', () => {
    it('CA4: pide confirmación y retira con la versión mostrada; la rutina se conserva', async () => {
      await create();
      await click('Retirar', item(ROUTINE.id));

      const confirm = byTestId(`routine-retire-confirm-${ROUTINE.id}`)!;
      expect(confirm.getAttribute('role')).toBe('group');
      expect(confirm.textContent).toContain(`¿Retirar «${VALID_PUBLISH_ROUTINE_REQUEST.title}»?`);
      expect(retire).not.toHaveBeenCalled();
      await click('Sí, retirar', confirm);

      expect(retire).toHaveBeenCalledOnceWith(ROUTINE.id, 1);
      expect(item(ROUTINE.id).textContent).toContain('Retirada');
      expect(text(`routine-retire-message-${ROUTINE.id}`)).toContain('Retiramos la rutina');
      expect(button('Retirar', item(ROUTINE.id))).toBeUndefined();
      expect(items().length).toBe(20);
    });

    it('no envía dos retiros a la vez y, si la página se cierra, ignora el resultado', async () => {
      let finish!: (outcome: RetireOutcome) => void;
      retire.and.returnValue(new Promise<RetireOutcome>((resolve) => (finish = resolve)));
      await create();
      await click('Retirar', item(ROUTINE.id));
      button('Sí, retirar')!.click();
      await settle();

      expect(button('Retirando…')?.disabled).toBeTrue();
      button('Retirando…')!.click();
      expect(retire).toHaveBeenCalledTimes(1);
      fixture.destroy();
      finish({ kind: 'retired', routine: RETIRED });
      await new Promise((resolve) => setTimeout(resolve));
    });

    it('cancelar la confirmación no retira', async () => {
      await create();
      await click('Retirar', item(ROUTINE.id));
      await click('Cancelar', byTestId(`routine-retire-confirm-${ROUTINE.id}`)!);

      expect(retire).not.toHaveBeenCalled();
      expect(byTestId(`routine-retire-confirm-${ROUTINE.id}`)).toBeNull();
    });

    it('un 409 version_conflict no retira y ofrece actualizar la lista', async () => {
      retire.and.resolveTo({ kind: 'conflict', currentVersion: 2 });
      await create();
      await click('Retirar', item(ROUTINE.id));
      await click('Sí, retirar');

      const message = byTestId(`routine-retire-message-${ROUTINE.id}`)!;
      expect(message.getAttribute('role')).toBe('alert');
      expect(message.textContent).toContain('no se retiró');
      expect(item(ROUTINE.id).textContent).toContain('Publicada');
      await click('Actualizar lista', message);
      expect(loadRoutines).toHaveBeenCalledTimes(2);
    });

    it('CA4: una rutina ajena se informa sin éxito', async () => {
      retire.and.resolveTo(failed(404, 'template_not_found'));
      await create();
      await click('Retirar', item(ROUTINE.id));
      await click('Sí, retirar');

      expect(text(`routine-retire-message-${ROUTINE.id}`)).toContain(
        'La rutina no existe o no es tuya.',
      );
      expect(text(`routine-retire-message-${ROUTINE.id}`)).toContain(
        SIMULATED_ROUTINES_CORRELATION_ID,
      );
    });

    it('un fallo genérico al retirar se informa con su tipo', async () => {
      retire.and.resolveTo({
        kind: 'failed',
        error: toApiError(new HttpErrorResponse({ status: 0 })),
      } satisfies RetireOutcome);
      await create();
      await click('Retirar', item(ROUTINE.id));
      await click('Sí, retirar');

      expect(text(`routine-retire-message-${ROUTINE.id}`)).toContain('No hay conexión');
    });
  });

  describe('catálogo de alimentos', () => {
    it('sin el catálogo cargado los alimentos de la lista se muestran por su código', async () => {
      loadCatalog.and.returnValue(new Promise(() => undefined));
      await create();

      const meals = item(ROUTINE.id).querySelector('[data-testid="routine-meals-list"]')!;
      expect(meals.textContent).toContain('OATS ×2');
    });

    it('un fallo del catálogo se muestra con reintento en lugar del formulario, nunca vacío', async () => {
      loadCatalog.and.rejectWith(
        new HttpErrorResponse({
          status: 503,
          error: MY_ROUTINES_RESPONSES.upstreamUnavailable.body,
        }),
      );
      await create();
      await click('Publicar una rutina');

      const catalog = byTestId('routine-catalog')!;
      expect(catalog.querySelector('[data-testid="state-error"]')?.textContent).toContain(
        SIMULATED_ROUTINES_CORRELATION_ID,
      );
      expect(byTestId('routine-form')).toBeNull();

      loadCatalog.and.resolveTo(CATALOG);
      await click('Reintentar', catalog);
      expect(loadCatalog).toHaveBeenCalledTimes(2);
      expect(byTestId('routine-form')).not.toBeNull();
    });

    it('un catálogo vacío lo explica sin mostrar el formulario', async () => {
      loadCatalog.and.resolveTo({ version: 'v', foods: [] } satisfies FoodCatalog);
      await create();
      await click('Publicar una rutina');

      expect(text('routine-catalog')).toContain('no tiene alimentos disponibles');
      expect(byTestId('routine-form')).toBeNull();
    });
  });

  it('aclara que publicar no asigna un plan y que no reemplaza una valoración médica', async () => {
    await create();
    expect(element.textContent).toContain('Una rutina no se asigna a nadie');
    expect(element.textContent).toContain('Una rutina retirada deja de sugerirse');

    await click('Publicar una rutina');
    expect(text('routine-disclaimer')).toContain('no reemplaza una valoración médica');
  });
});
