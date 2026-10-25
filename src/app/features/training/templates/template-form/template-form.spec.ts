import { LOCALE_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { MatSelectHarness } from '@angular/material/select/testing';

import { VALID_PUBLISH_TEMPLATE_REQUEST } from '../../../../../testing/bff-web/training-templates.fixtures';
import { provideTranslateTesting } from '../../../../../testing/translate-testing';
import { DEFAULT_LANGUAGE } from '../../../../core/i18n/i18n.providers';
import { TemplateDraft, TemplateViolation } from '../templates.model';
import { TemplateForm } from './template-form';

describe('TemplateForm (HU028)', () => {
  let fixture: ComponentFixture<TemplateForm>;
  let element: HTMLElement;
  let loader: HarnessLoader;
  let submitted: TemplateDraft[];
  let edited: number;
  let cancelled: number;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TemplateForm],
      providers: [provideTranslateTesting(), { provide: LOCALE_ID, useValue: DEFAULT_LANGUAGE }],
    }).compileComponents();
    fixture = TestBed.createComponent(TemplateForm);
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

  async function submit(): Promise<void> {
    element.querySelector('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
  }

  const session = (index: number, name: string) =>
    `[data-session="${index}"] [formcontrolname="${name}"]`;

  async function fillSession(index: number, day: string, minutes: string, description: string) {
    await choose(session(index, 'dayOfWeek'), day);
    type(session(index, 'durationMinutes'), minutes);
    type(session(index, 'description'), description);
  }

  async function fillValid(): Promise<void> {
    type('[formcontrolname="title"]', '  Base aeróbica para 10K ');
    type('[formcontrolname="objectives"]', ` ${VALID_PUBLISH_TEMPLATE_REQUEST.objectives} `);
    await choose('[formcontrolname="sport"]', 'Carrera');
    await choose('[formcontrolname="goal"]', 'Rendimiento');
    await choose('[formcontrolname="level"]', 'Principiante');
    type('[formcontrolname="durationWeeks"]', '8');
    await fillSession(0, 'Lunes', '40', 'Trote suave continuo.');
    await fixture.whenStable();
  }

  const fieldText = (selector: string) =>
    input(selector).closest('mat-form-field')?.textContent ?? '';

  it('CA4: envía la plantilla normalizada con las sesiones en el orden del profesional', async () => {
    await fillValid();
    button('Agregar sesión')!.click();
    await fixture.whenStable();
    await fillSession(1, 'Miércoles', '45', ' Intervalos de 4 x 5 minutos. ');
    button('Agregar sesión')!.click();
    await fixture.whenStable();
    await fillSession(2, 'Sábado', '70', 'Fondo largo a ritmo cómodo.');
    await submit();

    expect(submitted).toEqual([
      {
        title: 'Base aeróbica para 10K',
        objectives: VALID_PUBLISH_TEMPLATE_REQUEST.objectives,
        sport: 'running',
        goal: 'PERFORMANCE',
        level: 'BEGINNER',
        durationWeeks: 8,
        weeklySessions: [
          { dayOfWeek: 'MON', description: 'Trote suave continuo.', durationMinutes: 40 },
          { dayOfWeek: 'WED', description: 'Intervalos de 4 x 5 minutos.', durationMinutes: 45 },
          { dayOfWeek: 'SAT', description: 'Fondo largo a ritmo cómodo.', durationMinutes: 70 },
        ],
      },
    ]);
    expect(edited).toBeGreaterThan(0);
  });

  it('CA4: no envía una plantilla incompleta y marca lo que falta', async () => {
    await submit();

    expect(submitted).toEqual([]);
    expect(element.querySelectorAll('mat-error').length).toBeGreaterThan(6);
  });

  it('respeta las longitudes del contrato tras recortar', async () => {
    await fillValid();
    type('[formcontrolname="title"]', ' ab ');
    type('[formcontrolname="objectives"]', ' Correr más rápido. ');
    await submit();

    expect(submitted).toEqual([]);
    expect(fieldText('[formcontrolname="title"]')).toContain('3');
    expect(fieldText('[formcontrolname="objectives"]')).toContain('20');

    type('[formcontrolname="title"]', 'x'.repeat(121));
    type('[formcontrolname="objectives"]', VALID_PUBLISH_TEMPLATE_REQUEST.objectives);
    type(session(0, 'description'), '   ');
    await submit();
    expect(submitted).toEqual([]);
    expect(fieldText('[formcontrolname="title"]')).toContain('120');
    expect(fieldText(session(0, 'description'))).toContain('obligatorio');
  });

  it('las semanas y los minutos son enteros dentro del rango del contrato', async () => {
    await fillValid();
    type('[formcontrolname="durationWeeks"]', '53');
    type(session(0, 'durationMinutes'), '9');
    await submit();
    expect(submitted).toEqual([]);
    expect(fieldText('[formcontrolname="durationWeeks"]')).toContain('52');
    expect(fieldText(session(0, 'durationMinutes'))).toContain('10');

    type('[formcontrolname="durationWeeks"]', '2.5');
    type(session(0, 'durationMinutes'), '601');
    await submit();
    expect(submitted).toEqual([]);
    expect(fieldText('[formcontrolname="durationWeeks"]')).toContain('Usa un número entero.');
    expect(fieldText(session(0, 'durationMinutes'))).toContain('600');
  });

  it('agrega y quita sesiones con controles accesibles, entre 1 y 14', async () => {
    const remove = (n: number) =>
      element.querySelector<HTMLButtonElement>(`[aria-label="Quitar la sesión ${n}"]`)!;

    expect(element.querySelectorAll('[data-session]').length).toBe(1);
    expect(remove(1).disabled).toBeTrue();

    button('Agregar sesión')!.click();
    await fixture.whenStable();
    expect(element.querySelector('[data-session="1"]')?.getAttribute('aria-label')).toBe(
      'Sesión 2',
    );
    expect(element.querySelector('[data-session="1"]')?.getAttribute('role')).toBe('group');
    expect(remove(1).disabled).toBeFalse();
    remove(1).click();
    await fixture.whenStable();
    expect(element.querySelectorAll('[data-session]').length).toBe(1);

    for (let count = 1; count < 14; count++) {
      button('Agregar sesión')!.click();
    }
    await fixture.whenStable();
    expect(element.querySelectorAll('[data-session]').length).toBe(14);
    expect(byTestId('template-add-session')!.hasAttribute('disabled')).toBeTrue();
  });

  it('cada control tiene su etiqueta visible por sesión', async () => {
    button('Agregar sesión')!.click();
    await fixture.whenStable();

    const labels = [...element.querySelectorAll('[data-session="1"] mat-label')].map((label) =>
      label.textContent?.trim(),
    );
    expect(labels).toEqual([
      'Día de la sesión 2',
      'Duración de la sesión 2 (minutos)',
      'Descripción de la sesión 2',
    ]);
  });

  it('CA4: marca las reglas del backend en su campo y en su sesión, y las resume', async () => {
    await fillValid();
    button('Agregar sesión')!.click();
    button('Agregar sesión')!.click();
    await fixture.whenStable();
    const violations: TemplateViolation[] = [
      { field: 'title', issue: 'invalid_length' },
      { field: 'duration_weeks', issue: 'out_of_range' },
      { field: 'weekly_sessions.1.duration_minutes', issue: 'out_of_range' },
      { field: 'weekly_sessions.2.description', issue: 'string_too_short' },
      { field: 'professional_id', issue: 'extra_forbidden' },
    ];
    fixture.componentRef.setInput('serverErrors', violations);
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();

    const summary = byTestId('template-errors')!;
    expect(document.activeElement).toBe(summary);
    expect(summary.getAttribute('role')).toBe('alert');
    expect([...summary.querySelectorAll('li')].map((li) => li.textContent?.trim())).toEqual([
      'Título: La longitud no es válida.',
      'Duración (semanas): El valor está fuera del rango permitido.',
      'Sesión 2 (duración): El valor está fuera del rango permitido.',
      'Sesión 3 (descripción): La longitud no es válida.',
      'Solicitud: Este dato no se puede enviar.',
    ]);
    expect(fieldText('[formcontrolname="title"]')).toContain('La longitud no es válida.');
    expect(fieldText(session(1, 'durationMinutes'))).toContain('fuera del rango permitido');
  });

  it('al editar se retira la marca del backend del campo', async () => {
    await fillValid();
    fixture.componentRef.setInput('serverErrors', [
      { field: 'title', issue: 'invalid_length' },
    ] satisfies TemplateViolation[]);
    await fixture.whenStable();
    expect(fieldText('[formcontrolname="title"]')).toContain('La longitud no es válida.');

    type('[formcontrolname="title"]', 'Base aeróbica renovada');
    await fixture.whenStable();
    expect(fieldText('[formcontrolname="title"]')).not.toContain('La longitud no es válida.');
  });

  it('una sesión inexistente o la lista completa solo aparecen en el resumen', async () => {
    await fillValid();
    fixture.componentRef.setInput('serverErrors', [
      { field: 'weekly_sessions.5.description', issue: 'invalid_length' },
      { field: 'weekly_sessions', issue: 'too_long' },
    ] satisfies TemplateViolation[]);
    await fixture.whenStable();

    expect(
      [...byTestId('template-errors')!.querySelectorAll('li')].map((li) => li.textContent?.trim()),
    ).toEqual([
      'Sesión 6 (descripción): La longitud no es válida.',
      'Sesiones de la semana tipo: El valor está fuera del rango permitido.',
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
