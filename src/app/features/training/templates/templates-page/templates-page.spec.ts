import { HttpErrorResponse } from '@angular/common/http';
import { LOCALE_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  MY_TEMPLATES_RESPONSES,
  TEMPLATES_NEXT_CURSOR,
  SIMULATED_TEMPLATES_CORRELATION_ID,
  VALID_PUBLISH_TEMPLATE_REQUEST,
  professionalTemplate,
} from '../../../../../testing/bff-web/training-templates.fixtures';
import { provideTranslateTesting } from '../../../../../testing/translate-testing';
import { toApiError } from '../../../../core/api/api-error';
import { DEFAULT_LANGUAGE } from '../../../../core/i18n/i18n.providers';
import { TemplateForm } from '../template-form/template-form';
import { TemplatesGateway } from '../templates.gateway';
import {
  PublishOutcome,
  RetireOutcome,
  TemplateDraft,
  TemplatesPage as Page,
  TrainingTemplate,
  toTrainingTemplate,
} from '../templates.model';
import { TemplatesPage } from './templates-page';

// Datos sintéticos derivados de los fixtures del contrato bff-web 0.24.0.
const FIRST: Page = {
  templates: MY_TEMPLATES_RESPONSES.firstPage.body.items.map(toTrainingTemplate),
  nextCursor: TEMPLATES_NEXT_CURSOR,
};
const LAST: Page = {
  templates: MY_TEMPLATES_RESPONSES.lastPage.body.items.map(toTrainingTemplate),
  nextCursor: null,
};
const TEMPLATE: TrainingTemplate = toTrainingTemplate(professionalTemplate(0));
const RETIRED: TrainingTemplate = toTrainingTemplate(professionalTemplate(0, 'RETIRED'));
const NEW_TEMPLATE: TrainingTemplate = {
  ...TEMPLATE,
  id: 'nueva-plantilla',
  title: 'Plantilla nueva',
};
const DRAFT: TemplateDraft = {
  title: VALID_PUBLISH_TEMPLATE_REQUEST.title,
  objectives: VALID_PUBLISH_TEMPLATE_REQUEST.objectives,
  sport: 'running',
  goal: 'PERFORMANCE',
  level: 'BEGINNER',
  durationWeeks: 8,
  weeklySessions: [{ dayOfWeek: 'MON', description: 'Trote suave continuo.', durationMinutes: 40 }],
};
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
          correlation_id: SIMULATED_TEMPLATES_CORRELATION_ID,
          details: [],
        },
      }),
    ),
  };
}

describe('TemplatesPage (HU028)', () => {
  let fixture: ComponentFixture<TemplatesPage>;
  let element: HTMLElement;
  let loadTemplates: jasmine.Spy;
  let publish: jasmine.Spy;
  let retire: jasmine.Spy;

  async function create(): Promise<void> {
    fixture = TestBed.createComponent(TemplatesPage);
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
  const items = () => [...element.querySelectorAll<HTMLElement>('li[data-template]')];
  const item = (id: string) => element.querySelector<HTMLElement>(`li[data-template="${id}"]`)!;

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

  function form(): TemplateForm {
    return fixture.debugElement.query((el) => el.componentInstance instanceof TemplateForm)
      .componentInstance as TemplateForm;
  }

  async function submit(draft: TemplateDraft = DRAFT): Promise<void> {
    form().submitted.emit(draft);
    await settle();
  }

  function keys(): string[] {
    return publish.calls.allArgs().map(([, key]) => key as string);
  }

  beforeEach(async () => {
    loadTemplates = jasmine.createSpy('loadTemplates').and.resolveTo(FIRST);
    publish = jasmine.createSpy('publish').and.resolveTo({
      kind: 'published',
      template: NEW_TEMPLATE,
      replayed: false,
    } satisfies PublishOutcome);
    retire = jasmine
      .createSpy('retire')
      .and.resolveTo({ kind: 'retired', template: RETIRED } satisfies RetireOutcome);
    await TestBed.configureTestingModule({
      imports: [TemplatesPage],
      providers: [
        provideTranslateTesting(),
        { provide: LOCALE_ID, useValue: DEFAULT_LANGUAGE },
        { provide: TemplatesGateway, useValue: { loadTemplates, publish, retire } },
      ],
    }).compileComponents();
  });

  it('muestra la carga mientras consulta las plantillas', async () => {
    loadTemplates.and.returnValue(new Promise(() => undefined));
    await create();

    expect(element.querySelector('h1')?.textContent).toContain('Plantillas de entrenamiento');
    expect(byTestId('state-loading')).not.toBeNull();
  });

  it('lista las plantillas propias con sus datos y pagina con el cursor', async () => {
    await create();

    expect(items().length).toBe(20);
    const first = item(TEMPLATE.id);
    expect(first.querySelector('h3')?.textContent).toContain('Base aeróbica para 10K');
    expect(first.textContent).toContain('Publicada');
    expect(first.textContent).toContain('Construir una base aeróbica estable');
    expect(first.textContent).toContain('Carrera');
    expect(first.textContent).toContain('Rendimiento');
    expect(first.textContent).toContain('Principiante');
    expect(first.querySelector('[data-testid="template-weeks"]')?.textContent?.trim()).toBe('8');
    const sessions = first.querySelector('[data-testid="template-sessions-list"]')!;
    expect(sessions.textContent?.replace(SPACES, ' ')).toContain('3 por semana · 155 min en total');
    expect(
      [...sessions.querySelectorAll('li')].map((li) => li.textContent?.replace(SPACES, ' ').trim()),
    ).toEqual([
      'Lunes · 40 min · Trote suave continuo.',
      'Miércoles · 45 min · Intervalos de 4 x 5 minutos.',
      'Sábado · 70 min · Fondo largo a ritmo cómodo.',
    ]);
    expect(item(FIRST.templates[1].id).textContent).toContain('Intermedio');

    loadTemplates.and.resolveTo(LAST);
    await click('Cargar más');
    expect(loadTemplates.calls.mostRecent().args).toEqual([TEMPLATES_NEXT_CURSOR]);
    expect(items().length).toBe(22);
    expect(items()[21].textContent).toContain('Retirada');
    expect(items()[21].querySelector('[data-testid="template-retired-at"]')).not.toBeNull();
    expect(button('Retirar', items()[21])).toBeUndefined();
    expect(byTestId('templates-load-more')).toBeNull();
  });

  it('sin plantillas lo explica y un error se muestra con referencia y reintento', async () => {
    loadTemplates.and.resolveTo({ templates: [], nextCursor: null });
    await create();
    expect(byTestId('state-empty')?.textContent).toContain('Aún no has publicado plantillas.');

    loadTemplates.and.rejectWith(
      new HttpErrorResponse({
        status: 503,
        error: MY_TEMPLATES_RESPONSES.upstreamUnavailable.body,
      }),
    );
    await create();
    expect(byTestId('state-error')?.textContent).toContain(SIMULATED_TEMPLATES_CORRELATION_ID);
  });

  it('mientras carga más deshabilita el botón y un fallo con referencia la muestra', async () => {
    await create();
    let fail!: (error: unknown) => void;
    loadTemplates.and.returnValue(new Promise((_resolve, reject) => (fail = reject)));
    button('Cargar más')!.click();
    await settle();

    expect(button('Cargando…')?.disabled).toBeTrue();
    fail(
      new HttpErrorResponse({
        status: 503,
        error: MY_TEMPLATES_RESPONSES.upstreamUnavailable.body,
      }),
    );
    await settle();
    expect(text('templates-more-error')).toContain(SIMULATED_TEMPLATES_CORRELATION_ID);
  });

  it('un fallo al cargar más conserva lo mostrado', async () => {
    await create();
    loadTemplates.and.rejectWith(new HttpErrorResponse({ status: 0 }));
    await click('Cargar más');

    expect(text('templates-more-error')).toContain('No pudimos cargar más plantillas');
    expect(items().length).toBe(20);
  });

  describe('publicar', () => {
    it('CA4: publica con una clave por intento, muestra lo confirmado y lo agrega primero', async () => {
      await create();
      await click('Publicar una plantilla');
      await submit();

      expect(publish).toHaveBeenCalledOnceWith(
        DRAFT,
        jasmine.stringMatching(/^[0-9a-f-]{36}$/),
        jasmine.any(Function),
      );
      const message = byTestId('template-published')!;
      expect(message.getAttribute('role')).toBe('status');
      expect(message.textContent).toContain('Publicamos la plantilla «Plantilla nueva».');
      expect(document.activeElement).toBe(message);
      expect(items()[0].dataset['template']).toBe('nueva-plantilla');
      expect(byTestId('template-form')).toBeNull();
    });

    it('CA4: informa que la confirmación corresponde a un envío anterior', async () => {
      publish.and.resolveTo({ kind: 'published', template: TEMPLATE, replayed: true });
      await create();
      await click('Publicar una plantilla');
      await submit();

      expect(byTestId('template-published-replayed')).not.toBeNull();
      // La plantilla ya estaba en la lista: no se duplica.
      expect(items().filter((li) => li.dataset['template'] === TEMPLATE.id).length).toBe(1);
    });

    it('CA4: entrega al formulario las reglas del backend y nada se publica', async () => {
      const violations = [{ field: 'duration_weeks', issue: 'out_of_range' }];
      publish.and.resolveTo({ kind: 'invalid', violations });
      await create();
      await click('Publicar una plantilla');
      await submit();

      expect(form().serverErrors()).toEqual(violations);
      expect(byTestId('template-published')).toBeNull();
      expect(items().length).toBe(20);
      // Sin editar, volver a enviar es el mismo intento lógico.
      await submit();
      expect(keys()[1]).toBe(keys()[0]);
    });

    it('tras un fallo recuperable, reintentar usa la misma clave; editar la renueva', async () => {
      publish.and.resolveTo(failed(503, 'upstream_unavailable'));
      await create();
      await click('Publicar una plantilla');
      await submit();

      const error = byTestId('template-publish-error')!;
      expect(error.getAttribute('role')).toBe('alert');
      expect(error.textContent).toContain('no se publicará una plantilla duplicada');
      expect(error.textContent).toContain(SIMULATED_TEMPLATES_CORRELATION_ID);
      await submit();
      expect(keys()[1]).toBe(keys()[0]);
      form().edited.emit();
      await submit();
      expect(keys()[2]).not.toBe(keys()[1]);
    });

    it('idempotency_key_reused se explica y renueva la clave; el permiso denegado se informa', async () => {
      publish.and.resolveTo(failed(409, 'idempotency_key_reused'));
      await create();
      await click('Publicar una plantilla');
      await submit();
      expect(text('template-publish-error')).toContain('No pudimos confirmar la publicación');
      await submit();
      expect(keys()[1]).not.toBe(keys()[0]);

      publish.and.resolveTo(failed(403, 'permission_required'));
      await submit();
      expect(text('template-publish-error')).toContain('No tienes permiso');
    });

    it('avisa los reintentos automáticos y no envía dos veces', async () => {
      let finish!: (outcome: PublishOutcome) => void;
      publish.and.callFake((_draft: TemplateDraft, _key: string, onRetry: (n: number) => void) => {
        onRetry(2);
        return new Promise<PublishOutcome>((resolve) => (finish = resolve));
      });
      await create();
      await click('Publicar una plantilla');
      form().submitted.emit(DRAFT);
      form().submitted.emit(DRAFT);
      await settle();

      expect(publish).toHaveBeenCalledTimes(1);
      expect(text('template-retrying')).toContain('Reintentando publicar la plantilla (2 de 3)');
      finish({ kind: 'published', template: NEW_TEMPLATE, replayed: false });
      await settle();
      expect(byTestId('template-published')).not.toBeNull();
    });

    it('un fallo sin conexión se informa sin código de referencia', async () => {
      publish.and.resolveTo({
        kind: 'failed',
        error: toApiError(new HttpErrorResponse({ status: 0 })),
      } satisfies PublishOutcome);
      await create();
      await click('Publicar una plantilla');
      await submit();

      expect(text('template-publish-error')).toContain('No hay conexión');
      expect(text('template-publish-error')).not.toContain('Código de referencia');
    });

    it('si la página se cierra mientras publica, ignora el resultado', async () => {
      let finish!: (outcome: PublishOutcome) => void;
      publish.and.returnValue(new Promise<PublishOutcome>((resolve) => (finish = resolve)));
      await create();
      await click('Publicar una plantilla');
      form().submitted.emit(DRAFT);
      await settle();
      fixture.destroy();
      finish({ kind: 'published', template: NEW_TEMPLATE, replayed: false });
      await new Promise((resolve) => setTimeout(resolve));

      expect(publish).toHaveBeenCalledTimes(1);
    });

    it('cancelar cierra el formulario sin publicar', async () => {
      await create();
      await click('Publicar una plantilla');
      form().cancelled.emit();
      await settle();

      expect(byTestId('template-form')).toBeNull();
      expect(publish).not.toHaveBeenCalled();
    });
  });

  describe('retirar', () => {
    it('CA3: pide confirmación y retira con la versión mostrada; la plantilla se conserva', async () => {
      await create();
      await click('Retirar', item(TEMPLATE.id));

      const confirm = byTestId(`template-retire-confirm-${TEMPLATE.id}`)!;
      expect(confirm.getAttribute('role')).toBe('group');
      expect(confirm.textContent).toContain('¿Retirar «Base aeróbica para 10K»?');
      expect(retire).not.toHaveBeenCalled();
      await click('Sí, retirar', confirm);

      expect(retire).toHaveBeenCalledOnceWith(TEMPLATE.id, 1);
      expect(item(TEMPLATE.id).textContent).toContain('Retirada');
      expect(text(`template-retire-message-${TEMPLATE.id}`)).toContain('Retiramos la plantilla');
      expect(button('Retirar', item(TEMPLATE.id))).toBeUndefined();
      expect(items().length).toBe(20);
    });

    it('no envía dos retiros a la vez y, si la página se cierra, ignora el resultado', async () => {
      let finish!: (outcome: RetireOutcome) => void;
      retire.and.returnValue(new Promise<RetireOutcome>((resolve) => (finish = resolve)));
      await create();
      await click('Retirar', item(TEMPLATE.id));
      button('Sí, retirar')!.click();
      await settle();

      expect(button('Retirando…')?.disabled).toBeTrue();
      button('Retirando…')!.click();
      expect(retire).toHaveBeenCalledTimes(1);
      fixture.destroy();
      finish({ kind: 'retired', template: RETIRED });
      await new Promise((resolve) => setTimeout(resolve));
    });

    it('cancelar la confirmación no retira', async () => {
      await create();
      await click('Retirar', item(TEMPLATE.id));
      await click('Cancelar', byTestId(`template-retire-confirm-${TEMPLATE.id}`)!);

      expect(retire).not.toHaveBeenCalled();
      expect(byTestId(`template-retire-confirm-${TEMPLATE.id}`)).toBeNull();
    });

    it('un 409 version_conflict no retira y ofrece actualizar la lista', async () => {
      retire.and.resolveTo({ kind: 'conflict', currentVersion: 2 });
      await create();
      await click('Retirar', item(TEMPLATE.id));
      await click('Sí, retirar');

      const message = byTestId(`template-retire-message-${TEMPLATE.id}`)!;
      expect(message.getAttribute('role')).toBe('alert');
      expect(message.textContent).toContain('no se retiró');
      expect(item(TEMPLATE.id).textContent).toContain('Publicada');
      await click('Actualizar lista', message);
      expect(loadTemplates).toHaveBeenCalledTimes(2);
    });

    it('CA3: una plantilla ajena se informa sin éxito', async () => {
      retire.and.resolveTo(failed(404, 'template_not_found'));
      await create();
      await click('Retirar', item(TEMPLATE.id));
      await click('Sí, retirar');

      expect(text(`template-retire-message-${TEMPLATE.id}`)).toContain(
        'La plantilla no existe o no es tuya.',
      );
      expect(text(`template-retire-message-${TEMPLATE.id}`)).toContain(
        SIMULATED_TEMPLATES_CORRELATION_ID,
      );
    });

    it('un fallo genérico al retirar se informa con su tipo', async () => {
      retire.and.resolveTo({
        kind: 'failed',
        error: toApiError(new HttpErrorResponse({ status: 0 })),
      } satisfies RetireOutcome);
      await create();
      await click('Retirar', item(TEMPLATE.id));
      await click('Sí, retirar');

      expect(text(`template-retire-message-${TEMPLATE.id}`)).toContain('No hay conexión');
    });
  });

  it('aclara que publicar no asigna el plan a ningún deportista', async () => {
    await create();

    expect(element.textContent).toContain('Una plantilla no se asigna a nadie');
    expect(element.textContent).toContain('no la asigna ni inicia el plan');
  });
});
