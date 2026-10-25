import { LOCALE_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { MatCheckboxHarness } from '@angular/material/checkbox/testing';
import { MatSelectHarness } from '@angular/material/select/testing';

import { SPORT_HABITS_SECTION } from '../../../../../testing/bff-web/profile.fixtures';
import { provideTranslateTesting } from '../../../../../testing/translate-testing';
import { DEFAULT_LANGUAGE } from '../../../../core/i18n/i18n.providers';
import { ProfileViolation, SportHabits, SportHabitsDraft, toSportHabits } from '../profile.model';
import { SportHabitsForm } from './sport-habits-form';

// Datos sintéticos de prueba (ejemplo de ADR-034 con dos deportes).
const INITIAL: SportHabits = toSportHabits(SPORT_HABITS_SECTION);

describe('SportHabitsForm (HU006 y HU008)', () => {
  let fixture: ComponentFixture<SportHabitsForm>;
  let element: HTMLElement;
  let loader: HarnessLoader;
  let submitted: SportHabitsDraft[];
  let edited: number;
  let cancelled: number;

  async function create(initial: SportHabits | null = null): Promise<void> {
    fixture = TestBed.createComponent(SportHabitsForm);
    fixture.componentRef.setInput('initial', initial);
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
      imports: [SportHabitsForm],
      providers: [provideTranslateTesting(), { provide: LOCALE_ID, useValue: DEFAULT_LANGUAGE }],
    }).compileComponents();
  });

  function testId(id: string): HTMLElement | null {
    return element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  }

  function rows(): HTMLElement[] {
    return [...element.querySelectorAll<HTMLElement>('[data-testid^="sport-row-"]')].filter((row) =>
      /^sport-row-\d+$/.test(row.dataset['testid'] ?? ''),
    );
  }

  function input(row: number, name: string): HTMLInputElement {
    return testId(`sport-row-${row}`)!.querySelector<HTMLInputElement>(
      `[formcontrolname="${name}"]`,
    )!;
  }

  function type(row: number, name: string, value: string): void {
    const target = input(row, name);
    target.value = value;
    target.dispatchEvent(new Event('input'));
    target.dispatchEvent(new Event('blur'));
  }

  async function select(row: number, name: string): Promise<MatSelectHarness> {
    return loader.getHarness(
      MatSelectHarness.with({
        selector: `[data-testid="sport-row-${row}"] [formcontrolname="${name}"]`,
      }),
    );
  }

  async function choose(row: number, name: string, option: string): Promise<void> {
    const harness = await select(row, name);
    await harness.open();
    await harness.clickOptions({ text: option });
  }

  async function check(label: string): Promise<void> {
    const checkbox = await loader.getHarness(MatCheckboxHarness.with({ label }));
    await checkbox.toggle();
  }

  async function fillRow(row: number, sport: string): Promise<void> {
    await choose(row, 'sport', sport);
    type(row, 'frequencyPerWeek', '3');
    type(row, 'sessionDurationMinutes', '45');
    await choose(row, 'intensity', 'Moderada');
    await choose(row, 'level', 'Intermedio');
    await fixture.whenStable();
  }

  function button(text: string): HTMLButtonElement {
    return [...element.querySelectorAll<HTMLButtonElement>('button')].find(
      (item) => item.textContent?.trim() === text,
    )!;
  }

  async function click(target: HTMLElement): Promise<void> {
    target.click();
    await fixture.whenStable();
  }

  async function submit(): Promise<void> {
    element.querySelector('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
  }

  function errors(): string[] {
    return [...element.querySelectorAll('mat-error')].map((item) => item.textContent?.trim() ?? '');
  }

  async function setServerErrors(violations: readonly ProfileViolation[]): Promise<void> {
    fixture.componentRef.setInput('serverErrors', violations);
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  }

  it('vacío: una fila de deporte, días y franjas sin marcar y objetivo sin especificar', async () => {
    await create();

    expect(rows().length).toBe(1);
    expect(testId('sport-row-0')!.querySelector('legend')!.textContent?.trim()).toBe('Deporte 1');
    expect(testId('sport-row-remove-0')).toBeNull();
    const checkboxes = await loader.getAllHarnesses(MatCheckboxHarness);
    expect(checkboxes.length).toBe(11);
    for (const checkbox of checkboxes) {
      expect(await checkbox.isChecked()).toBeFalse();
    }
    const goal = await loader.getHarness(
      MatSelectHarness.with({ selector: '[formcontrolname="primaryGoal"]' }),
    );
    expect(await goal.getValueText()).toBe('');
  });

  it('accesibilidad: etiquetas, leyendas de grupo y controles de selección cerrados', async () => {
    await create();

    const labels = [...element.querySelectorAll('mat-label')].map((label) =>
      label.textContent?.trim(),
    );
    expect(labels).toEqual([
      'Deporte',
      'Veces por semana',
      'Duración por sesión (min)',
      'Intensidad',
      'Nivel',
      'Años practicándolo (opcional)',
      'Objetivo principal (opcional)',
    ]);
    const legends = [...element.querySelectorAll('legend')].map((legend) =>
      legend.textContent?.trim(),
    );
    expect(legends).toEqual([
      'Deportes que practicas',
      'Deporte 1',
      'Días disponibles',
      'Franjas horarias disponibles',
    ]);
    expect(input(0, 'frequencyPerWeek').type).toBe('number');
    expect(input(0, 'frequencyPerWeek').min).toBe('1');
    expect(input(0, 'frequencyPerWeek').max).toBe('7');
  });

  it('ofrece los catálogos cerrados de ADR-034', async () => {
    await create();
    const options = async (row: number, name: string) => {
      const harness = await select(row, name);
      await harness.open();
      const texts = await Promise.all((await harness.getOptions()).map((o) => o.getText()));
      await harness.close();
      return texts;
    };

    expect(await options(0, 'sport')).toEqual([
      'Carrera',
      'Ciclismo',
      'Natación',
      'Fuerza',
      'Otro',
    ]);
    expect(await options(0, 'intensity')).toEqual(['Baja', 'Moderada', 'Alta']);
    expect(await options(0, 'level')).toEqual(['Principiante', 'Intermedio', 'Avanzado']);
    const goal = await loader.getHarness(
      MatSelectHarness.with({ selector: '[formcontrolname="primaryGoal"]' }),
    );
    await goal.open();
    expect(await Promise.all((await goal.getOptions()).map((o) => o.getText()))).toEqual([
      'Sin especificar',
      'Salud',
      'Rendimiento',
      'Control de peso',
      'Recreación',
      'Competencia',
    ]);
  });

  it('CA1: emite el borrador con días y franjas en el orden del catálogo y opcionales en null', async () => {
    await create();
    await fillRow(0, 'Carrera');
    await check('Sábado');
    await check('Lunes');
    await check('Noche');
    await check('Mañana');
    await submit();

    expect(submitted).toEqual([
      {
        sports: [
          {
            sport: 'running',
            frequencyPerWeek: 3,
            sessionDurationMinutes: 45,
            intensity: 'MODERATE',
            level: 'INTERMEDIATE',
            yearsPracticing: null,
          },
        ],
        days: ['MON', 'SAT'],
        timeSlots: ['MORNING', 'NIGHT'],
        primaryGoal: null,
      },
    ]);
    expect(edited).toBeGreaterThan(0);
  });

  it('no envía sin días ni franjas y lo explica en cada grupo', async () => {
    await create();
    await fillRow(0, 'Carrera');
    await submit();

    expect(submitted).toEqual([]);
    expect(testId('sport-habits-days-error')?.textContent?.trim()).toBe(
      'Marca al menos un día disponible.',
    );
    expect(testId('sport-habits-time-slots-error')?.textContent?.trim()).toBe(
      'Marca al menos una franja horaria.',
    );
  });

  it('no envía un deporte incompleto y enfoca el primer campo inválido', async () => {
    await create();
    await check('Lunes');
    await check('Mañana');
    await submit();
    await new Promise((resolve) => setTimeout(resolve));

    expect(submitted).toEqual([]);
    expect(errors()).toContain('Este campo es obligatorio.');
    expect(element.contains(document.activeElement)).toBeTrue();
  });

  it('aplica los rangos y enteros del contrato a frecuencia, duración y años', async () => {
    await create();
    await fillRow(0, 'Carrera');
    await check('Lunes');
    await check('Mañana');

    type(0, 'frequencyPerWeek', '8');
    type(0, 'sessionDurationMinutes', '5');
    type(0, 'yearsPracticing', '2.5');
    await fixture.whenStable();
    await submit();

    expect(submitted).toEqual([]);
    expect(errors()).toContain('El valor máximo permitido es 7.');
    expect(errors()).toContain('El valor mínimo permitido es 10.');
    expect(errors()).toContain('Ingresa un número entero.');

    type(0, 'frequencyPerWeek', '7');
    type(0, 'sessionDurationMinutes', '600');
    type(0, 'yearsPracticing', '80');
    await fixture.whenStable();
    await submit();
    expect(submitted.length).toBe(1);
    expect(submitted[0].sports[0]).toEqual(
      jasmine.objectContaining({
        frequencyPerWeek: 7,
        sessionDurationMinutes: 600,
        yearsPracticing: 80,
      }),
    );
  });

  it('deporte repetido: un deporte elegido no se ofrece en otra fila', async () => {
    await create();
    await fillRow(0, 'Carrera');
    await click(button('Agregar deporte'));

    const second = await select(1, 'sport');
    await second.open();
    const options = await second.getOptions();
    const disabled = await Promise.all(
      options.map(async (option) => [await option.getText(), await option.isDisabled()] as const),
    );
    expect(disabled).toEqual([
      ['Carrera', true],
      ['Ciclismo', false],
      ['Natación', false],
      ['Fuerza', false],
      ['Otro', false],
    ]);
  });

  it('deporte repetido: si dos filas coinciden, se marca la fila y no se envía', async () => {
    await create();
    await fillRow(0, 'Carrera');
    await click(button('Agregar deporte'));
    await fillRow(1, 'Ciclismo');
    await check('Lunes');
    await check('Mañana');
    // Un valor que llega por otra vía (por ejemplo, un control programático) también se bloquea.
    const form = (
      fixture.componentInstance as unknown as {
        form: {
          controls: {
            sports: { at(i: number): { controls: { sport: { setValue(v: string): void } } } };
          };
        };
      }
    ).form;
    form.controls.sports.at(1).controls.sport.setValue('running');
    await fixture.whenStable();
    await submit();

    expect(submitted).toEqual([]);
    expect(testId('sport-row-duplicate-1')?.textContent?.trim()).toBe(
      'Este deporte ya está en otra fila.',
    );
    expect(testId('sport-row-duplicate-0')).toBeNull();
  });

  it('sexto deporte: agrega hasta cinco filas y luego deshabilita «Agregar deporte»', async () => {
    await create();
    for (let count = 1; count < 5; count++) {
      await click(button('Agregar deporte'));
    }

    expect(rows().length).toBe(5);
    expect(button('Agregar deporte').disabled).toBeTrue();
    expect(testId('sport-habits-max')?.textContent?.trim()).toBe(
      'Ya agregaste el máximo de 5 deportes.',
    );
    await click(button('Agregar deporte'));
    expect(rows().length).toBe(5);
  });

  it('agregar enfoca el deporte nuevo; quitar elimina la fila y enfoca «Agregar deporte»', async () => {
    await create();
    await fillRow(0, 'Carrera');
    await click(button('Agregar deporte'));
    await fixture.whenStable();

    expect(document.activeElement).toBe(
      testId('sport-row-1')!.querySelector<HTMLElement>('[data-focus="sport"]'),
    );
    expect(testId('sport-row-remove-1')!.getAttribute('aria-label')).toBe('Quitar el deporte 2');

    await click(testId('sport-row-remove-0')!);
    await fixture.whenStable();
    expect(rows().length).toBe(1);
    expect(testId('sport-row-remove-0')).toBeNull();
    expect(document.activeElement).toBe(testId('sport-habits-add'));
  });

  it('precarga los hábitos vigentes al reemplazar, sin contarlo como edición', async () => {
    await create(INITIAL);

    expect(rows().length).toBe(2);
    expect(await (await select(0, 'sport')).getValueText()).toBe('Carrera');
    expect(await (await select(1, 'sport')).getValueText()).toBe('Natación');
    expect(input(0, 'yearsPracticing').value).toBe('4');
    expect(input(1, 'yearsPracticing').value).toBe('');
    expect(
      await (await loader.getHarness(MatCheckboxHarness.with({ label: 'Miércoles' }))).isChecked(),
    ).toBeTrue();
    expect(
      await (await loader.getHarness(MatCheckboxHarness.with({ label: 'Martes' }))).isChecked(),
    ).toBeFalse();
    expect(edited).toBe(0);
  });

  it('CA2: marca las reglas del backend en la fila y el campo de su posición; editar las retira', async () => {
    await create(INITIAL);
    await setServerErrors([
      { field: 'sports[1].sport', issue: 'duplicate_value' },
      { field: 'sports[0].frequency_per_week', issue: 'out_of_range' },
      { field: 'availability.days[1]', issue: 'duplicate_value' },
      { field: 'user_id', issue: 'field_not_allowed' },
    ]);

    const summary = testId('sport-habits-errors')!;
    expect(summary.getAttribute('role')).toBe('alert');
    expect(document.activeElement).toBe(summary);
    expect([...summary.querySelectorAll('li')].map((li) => li.textContent?.trim())).toEqual([
      'Deporte 2 (deporte): Este deporte ya está en otra fila.',
      'Deporte 1 (veces por semana): El valor está fuera del rango permitido.',
      'Días disponibles: Hay valores repetidos.',
      'Solicitud: Este dato no se puede enviar.',
    ]);
    expect(testId('sport-row-1')!.querySelector('mat-error')?.textContent?.trim()).toBe(
      'Este deporte ya está en otra fila.',
    );
    expect(testId('sport-row-0')!.querySelector('mat-error')?.textContent?.trim()).toBe(
      'El valor está fuera del rango permitido.',
    );
    expect(testId('sport-habits-days-error')?.textContent?.trim()).toBe('Hay valores repetidos.');
    await submit();
    expect(submitted).toEqual([]);

    type(0, 'frequencyPerWeek', '2');
    await fixture.whenStable();
    expect(testId('sport-habits-days-error')).toBeNull();
    await submit();
    expect(submitted.length).toBe(1);
  });

  it('CA2: más de cinco deportes se explica junto a la lista', async () => {
    await create(INITIAL);
    await setServerErrors([{ field: 'sports', issue: 'too_many_items' }]);

    expect(testId('sport-habits-sports-rule')?.textContent?.trim()).toBe(
      'Puedes registrar como máximo 5 deportes.',
    );
    expect(testId('sport-habits-errors')?.textContent).toContain(
      'Deportes: Puedes registrar como máximo 5 deportes.',
    );
  });

  it('deshabilita el envío y los cambios de filas mientras se guarda; permite cancelar', async () => {
    await create(INITIAL);
    fixture.componentRef.setInput('submitting', true);
    await fixture.whenStable();
    await submit();

    expect(submitted).toEqual([]);
    expect(button('Guardar hábitos deportivos').disabled).toBeTrue();
    expect(button('Agregar deporte').disabled).toBeTrue();
    expect(testId('sport-row-remove-0')!.hasAttribute('disabled')).toBeTrue();

    fixture.componentRef.setInput('submitting', false);
    await fixture.whenStable();
    await click(button('Cancelar'));
    expect(cancelled).toBe(1);
  });
  describe('modo edición (HU008, ADR-035)', () => {
    it('al registrar no muestra el aviso de edición parcial; al editar sí', async () => {
      await create(null);
      expect(testId('sport-habits-partial-hint')).toBeNull();

      await create(INITIAL);
      expect(testId('sport-habits-partial-hint')?.textContent?.trim()).toBe(
        'Solo se guardan las secciones que cambies (deportes, disponibilidad u objetivo); las demás se conservan.',
      );
    });

    it('CA5: sin cambios no emite, lo avisa con role=status y editar retira el aviso', async () => {
      await create(INITIAL);
      await submit();
      await fixture.whenStable();

      expect(submitted).toEqual([]);
      const note = testId('sport-habits-unchanged')!;
      expect(note.getAttribute('role')).toBe('status');
      expect(note.textContent?.trim()).toBe('No cambiaste ningún dato: no hay nada que guardar.');
      expect(document.activeElement).toBe(note);

      await check('Martes');
      expect(testId('sport-habits-unchanged')).toBeNull();
    });

    it('CA1: editar solo el objetivo emite los hábitos con el resto sin cambios', async () => {
      await create(INITIAL);
      const goal = await loader.getHarness(
        MatSelectHarness.with({ selector: '[formcontrolname="primaryGoal"]' }),
      );
      await goal.open();
      await goal.clickOptions({ text: 'Sin especificar' });
      await submit();

      expect(submitted).toEqual([
        {
          sports: INITIAL.sports,
          days: INITIAL.days,
          timeSlots: INITIAL.timeSlots,
          primaryGoal: null,
        },
      ]);
    });

    it('CA1: editar solo la disponibilidad conserva los deportes capturados', async () => {
      await create(INITIAL);
      await check('Martes');
      await submit();

      expect(submitted.length).toBe(1);
      expect(submitted[0].sports).toEqual(INITIAL.sports);
      expect(submitted[0].days).toEqual(['MON', 'TUE', 'WED', 'SAT']);
      expect(submitted[0].primaryGoal).toBe('HEALTH');
    });

    it('CA1: editar un deporte emite la fila cambiada en su posición', async () => {
      await create(INITIAL);
      type(0, 'frequencyPerWeek', '4');
      await fixture.whenStable();
      await submit();

      expect(submitted.length).toBe(1);
      expect(submitted[0].sports[0].frequencyPerWeek).toBe(4);
      expect(submitted[0].sports[1]).toEqual(INITIAL.sports[1]);
      expect(submitted[0].days).toEqual(INITIAL.days);
    });

    it('CA5: un 422 del PATCH se marca por campo e índice', async () => {
      await create(INITIAL);
      await setServerErrors([
        { field: 'sports[1].sport', issue: 'duplicate_value' },
        { field: 'availability.time_slots[0]', issue: 'unknown_value' },
        { field: '', issue: 'required' },
      ]);

      expect(testId('sport-row-1')!.querySelector('mat-error')?.textContent?.trim()).toBe(
        'Este deporte ya está en otra fila.',
      );
      expect(testId('sport-habits-time-slots-error')).not.toBeNull();
      expect(testId('sport-habits-errors')!.querySelectorAll('li').length).toBe(3);
    });
  });
});
