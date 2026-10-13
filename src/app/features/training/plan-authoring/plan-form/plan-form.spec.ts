import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { provideTranslateTesting } from '../../../../../testing/translate-testing';
import { PlanDraft } from '../plan-authoring.model';
import { PlanForm, PlanServerErrors } from './plan-form';

// Datos sintéticos de prueba.
const VALID = {
  athleteEmail: '  deportista@example.com ',
  title: ' Base aeróbica ',
  objective: ' Mejorar la resistencia ',
  startDate: '2026-11-02',
  endDate: '2026-12-27',
  scheduledDate: '2026-11-03',
  duration: '45',
  rpe: '4',
};

describe('PlanForm (HU010)', () => {
  let fixture: ComponentFixture<PlanForm>;
  let element: HTMLElement;
  let reviewed: PlanDraft[];
  let edited: number;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlanForm],
      providers: [provideTranslateTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(PlanForm);
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

  async function chooseSport(sessionIndex: number, label: string): Promise<void> {
    const trigger = fixture.debugElement.queryAll(By.css('mat-select'))[sessionIndex];
    (trigger.nativeElement as HTMLElement).click();
    await fixture.whenStable();
    const option = [...document.querySelectorAll<HTMLElement>('mat-option')].find((o) =>
      o.textContent?.includes(label),
    );
    option!.click();
    await fixture.whenStable();
  }

  async function fillSession(index: number, date = VALID.scheduledDate): Promise<void> {
    type(input('[formcontrolname="scheduledDate"]', index), date);
    await chooseSport(index, 'Carrera');
    type(input('[formcontrolname="durationMinutes"]', index), VALID.duration);
    type(input('[formcontrolname="intensityRpe"]', index), VALID.rpe);
  }

  async function fillValid(): Promise<void> {
    type(input('[formcontrolname="athleteEmail"]'), VALID.athleteEmail);
    type(input('[formcontrolname="title"]'), VALID.title);
    type(input('[data-focus="objective"]'), VALID.objective);
    type(input('[formcontrolname="startDate"]'), VALID.startDate);
    type(input('[formcontrolname="endDate"]'), VALID.endDate);
    await fillSession(0);
    await fixture.whenStable();
  }

  async function submit(): Promise<void> {
    element.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
  }

  async function setServerErrors(errors: PlanServerErrors): Promise<void> {
    fixture.componentRef.setInput('serverErrors', errors);
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  }

  it('empieza con un objetivo y una sesión, que no se pueden quitar', () => {
    expect(element.querySelectorAll('[data-focus="objective"]').length).toBe(1);
    expect(element.querySelectorAll('[data-session]').length).toBe(1);
    expect(
      element.querySelector<HTMLButtonElement>('[aria-label="Quitar el objetivo 1"]')!.disabled,
    ).toBeTrue();
    expect(
      element.querySelector<HTMLButtonElement>('[aria-label="Quitar la sesión 1"]')!.disabled,
    ).toBeTrue();
  });

  it('no permite revisar un plan incompleto y señala los campos obligatorios', async () => {
    await submit();

    expect(reviewed).toEqual([]);
    expect(element.querySelectorAll('mat-error').length).toBeGreaterThan(0);
    expect(element.textContent).toContain('Este campo es obligatorio.');
  });

  it('emite el borrador normalizado cuando los datos son válidos', async () => {
    await fillValid();
    await submit();

    expect(reviewed).toEqual([
      {
        athleteEmail: 'deportista@example.com',
        title: 'Base aeróbica',
        objectives: ['Mejorar la resistencia'],
        startDate: '2026-11-02',
        endDate: '2026-12-27',
        sessions: [
          { scheduledDate: '2026-11-03', sport: 'running', durationMinutes: 45, intensityRpe: 4 },
        ],
      },
    ]);
    expect(edited).toBeGreaterThan(0);
  });

  it('permite de 1 a 5 objetivos (límite del contrato)', async () => {
    for (let i = 0; i < 4; i++) {
      button('Agregar objetivo').click();
      await fixture.whenStable();
    }

    expect(element.querySelectorAll('[data-focus="objective"]').length).toBe(5);
    expect(button('Agregar objetivo').disabled).toBeTrue();

    element.querySelector<HTMLButtonElement>('[aria-label="Quitar el objetivo 5"]')!.click();
    await fixture.whenStable();

    expect(element.querySelectorAll('[data-focus="objective"]').length).toBe(4);
    expect(button('Agregar objetivo').disabled).toBeFalse();
  });

  it('agrega y quita sesiones, cada una con su propio grupo rotulado', async () => {
    button('Agregar sesión').click();
    await fixture.whenStable();

    const legends = [...element.querySelectorAll('[data-session] legend')].map((l) =>
      l.textContent?.trim(),
    );
    expect(legends).toEqual(['Sesión 1', 'Sesión 2']);

    element.querySelector<HTMLButtonElement>('[aria-label="Quitar la sesión 1"]')!.click();
    await fixture.whenStable();

    expect(element.querySelectorAll('[data-session]').length).toBe(1);
  });

  it('aplica los rangos de duración e intensidad del contrato', async () => {
    await fillValid();
    type(input('[formcontrolname="durationMinutes"]'), '601');
    type(input('[formcontrolname="intensityRpe"]'), '0');
    await submit();

    expect(reviewed).toEqual([]);
    expect(element.textContent).toContain('El valor máximo permitido es 600.');
    expect(element.textContent).toContain('El valor mínimo permitido es 1.');
  });

  it('rechaza una duración no entera', async () => {
    await fillValid();
    type(input('[formcontrolname="durationMinutes"]'), '1.5');
    await submit();

    expect(reviewed).toEqual([]);
    expect(element.textContent).toContain('El valor no es válido.');
  });

  it('CA3: lista las reglas que informó el backend y marca cada campo', async () => {
    await fillValid();
    button('Agregar sesión').click();
    await fixture.whenStable();
    await fillSession(1);

    await setServerErrors({
      athleteNotAuthorized: false,
      violations: [
        { path: 'end_date', issue: 'end_date_before_start_date' },
        { path: 'sessions.1.scheduled_date', issue: 'outside_plan_period' },
        { path: 'sessions', issue: 'regla_nueva' },
      ],
    });

    const summary = element.querySelector<HTMLElement>('[data-testid="plan-errors"]')!;
    expect(summary.getAttribute('role')).toBe('alert');
    expect([...summary.querySelectorAll('li')].map((li) => li.textContent?.trim())).toEqual([
      'Fecha de fin: la fecha de fin es anterior a la de inicio.',
      'Fecha de la sesión 2: está fuera del periodo del plan.',
      'Sesiones: no cumple las reglas del plan.',
    ]);
    expect(document.activeElement).toBe(summary);
    const errors = [...element.querySelectorAll('mat-error')].map((e) => e.textContent?.trim());
    expect(errors).toContain('la fecha de fin es anterior a la de inicio.');
    expect(errors).toContain('está fuera del periodo del plan.');
  });

  it('CA3: corregir un campo relacionado retira las marcas del backend y permite revisar de nuevo', async () => {
    await fillValid();
    await setServerErrors({
      athleteNotAuthorized: false,
      violations: [{ path: 'end_date', issue: 'end_date_before_start_date' }],
    });
    await submit();
    expect(reviewed).toEqual([]);

    type(input('[formcontrolname="startDate"]'), '2026-11-01');
    await fixture.whenStable();
    await submit();

    expect(reviewed.length).toBe(1);
    expect(reviewed[0].startDate).toBe('2026-11-01');
    // El resumen del último envío sigue visible hasta el siguiente.
    expect(element.querySelector('[data-testid="plan-errors"]')).not.toBeNull();
  });

  it('CA2: indica en el correo que el deportista no autorizó al profesional', async () => {
    await fillValid();

    await setServerErrors({ athleteNotAuthorized: true, violations: [] });

    expect(element.querySelector('mat-error')?.textContent).toContain(
      'no corresponde a un deportista que te haya autorizado',
    );
    expect(element.querySelector('[data-testid="plan-errors"]')).toBeNull();
  });

  it('reset() vuelve al formulario inicial', async () => {
    await fillValid();
    button('Agregar sesión').click();
    await fixture.whenStable();

    await submit();

    fixture.componentInstance.reset();
    await fixture.whenStable();

    expect(element.querySelectorAll('[data-session]').length).toBe(1);
    expect(input('[formcontrolname="title"]').value).toBe('');
    expect(input('[formcontrolname="athleteEmail"]').value).toBe('');
    expect(element.querySelector('mat-error')).toBeNull();
  });
});
