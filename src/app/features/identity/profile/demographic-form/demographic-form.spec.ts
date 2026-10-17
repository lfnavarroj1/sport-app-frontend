import { LOCALE_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { MatSelectHarness } from '@angular/material/select/testing';

import { DEMOGRAPHIC_SECTION } from '../../../../../testing/bff-web/profile.fixtures';
import { provideTranslateTesting } from '../../../../../testing/translate-testing';
import { DEFAULT_LANGUAGE } from '../../../../core/i18n/i18n.providers';
import {
  DemographicDraft,
  DemographicProfile,
  ProfileViolation,
  localDate,
  toDemographicProfile,
} from '../profile.model';
import { DemographicForm } from './demographic-form';

// Datos sintéticos de prueba (ejemplo de ADR-034).
const INITIAL: DemographicProfile = toDemographicProfile(DEMOGRAPHIC_SECTION);

/** Fecha de nacimiento con `years` cumplidos hoy. */
function birthDateForAge(years: number): string {
  const today = new Date();
  return localDate(new Date(today.getFullYear() - years, today.getMonth(), today.getDate()));
}

describe('DemographicForm (HU005)', () => {
  let fixture: ComponentFixture<DemographicForm>;
  let element: HTMLElement;
  let loader: HarnessLoader;
  let submitted: DemographicDraft[];
  let edited: number;
  let cancelled: number;

  async function create(initial: DemographicProfile | null = null): Promise<void> {
    fixture = TestBed.createComponent(DemographicForm);
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
      imports: [DemographicForm],
      providers: [provideTranslateTesting(), { provide: LOCALE_ID, useValue: DEFAULT_LANGUAGE }],
    }).compileComponents();
  });

  function control(name: string): HTMLInputElement {
    return element.querySelector<HTMLInputElement>(`[formcontrolname="${name}"]`)!;
  }

  function type(name: string, value: string): void {
    const target = control(name);
    target.value = value;
    target.dispatchEvent(new Event('input'));
    target.dispatchEvent(new Event('blur'));
  }

  async function choose(label: string, option: string): Promise<void> {
    const select = await loader.getHarness(
      MatSelectHarness.with({ selector: `[formcontrolname="${label}"]` }),
    );
    await select.open();
    await select.clickOptions({ text: option });
  }

  async function fillRequired(): Promise<void> {
    type('birthDate', '1992-04-18');
    type('countryCode', 'co');
    type('city', '  Bogotá ');
    await choose('gender', 'Femenino');
    await fixture.whenStable();
  }

  async function submit(): Promise<void> {
    element.querySelector('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
  }

  function errors(): string[] {
    return [...element.querySelectorAll('mat-error')].map((item) => item.textContent?.trim() ?? '');
  }

  function testId(id: string): HTMLElement | null {
    return element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  }

  async function setServerErrors(violations: readonly ProfileViolation[]): Promise<void> {
    fixture.componentRef.setInput('serverErrors', violations);
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  }

  it('muestra los campos del contrato con etiquetas accesibles', async () => {
    await create();

    const labels = [...element.querySelectorAll('mat-label')].map((label) =>
      label.textContent?.trim(),
    );
    expect(labels).toEqual([
      'Fecha de nacimiento',
      'Género',
      'País de residencia (código)',
      'Ciudad de residencia',
      'Estado civil (opcional)',
      'Ocupación (opcional)',
      'Rango de ingresos (opcional)',
    ]);
    expect(control('birthDate').type).toBe('date');
  });

  it('ofrece los catálogos cerrados del contrato', async () => {
    await create();
    const select = await loader.getHarness(
      MatSelectHarness.with({ selector: '[formcontrolname="incomeRange"]' }),
    );
    await select.open();
    const options = await Promise.all((await select.getOptions()).map((o) => o.getText()));

    expect(options).toEqual([
      'Sin especificar',
      'Menos de 1 SMMLV',
      'Entre 1 y 2 SMMLV',
      'Entre 2 y 4 SMMLV',
      'Más de 4 SMMLV',
      'Prefiero no decirlo',
    ]);
  });

  it('no envía un formulario incompleto y enfoca el primer campo inválido', async () => {
    await create();
    await submit();
    await new Promise((resolve) => setTimeout(resolve));

    expect(submitted).toEqual([]);
    expect(errors()).toContain('Este campo es obligatorio.');
    expect(document.activeElement).toBe(control('birthDate'));
  });

  it('emite el borrador con textos recortados, país en mayúsculas y opcionales en null', async () => {
    await create();
    await fillRequired();
    type('occupation', '   ');
    await fixture.whenStable();

    expect(control('countryCode').value).toBe('CO');
    expect(testId('demographic-country-name')?.textContent).toContain('Colombia');
    await submit();

    expect(submitted).toEqual([
      {
        birthDate: '1992-04-18',
        gender: 'FEMALE',
        countryCode: 'CO',
        city: 'Bogotá',
        maritalStatus: null,
        occupation: null,
        incomeRange: null,
      },
    ]);
    expect(edited).toBeGreaterThan(0);
  });

  it('aplica longitudes tras recortar y el patrón del país', async () => {
    await create();
    await fillRequired();
    type('city', ' B ');
    type('occupation', ' x ');
    type('countryCode', 'C1');
    await fixture.whenStable();
    await submit();

    expect(submitted).toEqual([]);
    expect(errors()).toContain('Debe tener al menos 2 caracteres.');
    expect(errors()).toContain('El formato no es válido.');
  });

  it('muestra la edad como dato informativo, sin bloquear el envío fuera de rango', async () => {
    await create();
    await fillRequired();
    type('birthDate', birthDateForAge(30));
    await fixture.whenStable();

    expect(testId('demographic-age')?.textContent).toContain('Edad: 30 años.');
    expect(testId('demographic-age-warning')).toBeNull();

    type('birthDate', birthDateForAge(10));
    await fixture.whenStable();
    expect(testId('demographic-age')?.textContent).toContain('Edad: 10 años.');
    expect(testId('demographic-age-warning')?.textContent).toContain('entre 13 y 120 años');

    await submit();
    expect(submitted.length).toBe(1);
    expect(submitted[0].birthDate).toBe(birthDateForAge(10));
  });

  it('precarga la sección vigente al reemplazar, sin contarlo como edición', async () => {
    await create(INITIAL);

    expect(control('birthDate').value).toBe('1992-04-18');
    expect(control('countryCode').value).toBe('CO');
    expect(control('city').value).toBe('Bogotá');
    expect(control('occupation').value).toBe('Ingeniera');
    expect(testId('demographic-country-name')?.textContent).toContain('Colombia');
    expect(testId('demographic-age')).not.toBeNull();
    expect(edited).toBe(0);

    await submit();
    expect(submitted).toEqual([
      {
        birthDate: '1992-04-18',
        gender: 'FEMALE',
        countryCode: 'CO',
        city: 'Bogotá',
        maritalStatus: 'SINGLE',
        occupation: 'Ingeniera',
        incomeRange: '2_4_SMMLV',
      },
    ]);
  });

  it('CA2: lista las reglas del backend y marca los campos; editar retira las marcas', async () => {
    await create(INITIAL);
    await setServerErrors([
      { field: 'birth_date', issue: 'out_of_range' },
      { field: 'country_code', issue: 'unknown_value' },
      { field: 'user_id', issue: 'field_not_allowed' },
    ]);

    const summary = testId('demographic-errors')!;
    expect(summary.getAttribute('role')).toBe('alert');
    expect(document.activeElement).toBe(summary);
    expect([...summary.querySelectorAll('li')].map((li) => li.textContent?.trim())).toEqual([
      'Fecha de nacimiento: El valor está fuera del rango permitido.',
      'País de residencia (código): El valor no es válido.',
      'Solicitud: Este dato no se puede enviar.',
    ]);
    expect(errors()).toContain('El valor está fuera del rango permitido.');
    await submit();
    expect(submitted).toEqual([]);

    type('birthDate', '1990-01-01');
    await fixture.whenStable();
    await submit();
    expect(submitted.length).toBe(1);
  });

  it('deshabilita el envío mientras se guarda y permite cancelar', async () => {
    await create(INITIAL);
    fixture.componentRef.setInput('submitting', true);
    await fixture.whenStable();
    await submit();

    expect(submitted).toEqual([]);
    const save = [...element.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes('Guardar datos demográficos'),
    )!;
    expect(save.disabled).toBeTrue();

    fixture.componentRef.setInput('submitting', false);
    await fixture.whenStable();
    [...element.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent?.includes('Cancelar'))!
      .click();
    expect(cancelled).toBe(1);
  });
});
