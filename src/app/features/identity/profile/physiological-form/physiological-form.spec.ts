import { LOCALE_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  PHYSIOLOGICAL_SECTION,
  SIMULATED_HEALTH_CONSENT_VERSION,
} from '../../../../../testing/bff-web/profile.fixtures';
import { provideTranslateTesting } from '../../../../../testing/translate-testing';
import { MEASURED_AT_PATTERN } from '../../../../core/api/bff-web/profile.api';
import { DEFAULT_LANGUAGE } from '../../../../core/i18n/i18n.providers';
import {
  PhysiologicalDraft,
  PhysiologicalProfile,
  ProfileViolation,
  localDateTimeToUtc,
  toLocalDateTimeInput,
  toPhysiologicalProfile,
} from '../profile.model';
import { PhysiologicalForm } from './physiological-form';

// Datos sintéticos de prueba (ejemplo de ADR-034).
const INITIAL: PhysiologicalProfile = toPhysiologicalProfile(PHYSIOLOGICAL_SECTION);

describe('PhysiologicalForm (HU005)', () => {
  let fixture: ComponentFixture<PhysiologicalForm>;
  let element: HTMLElement;
  let submitted: PhysiologicalDraft[];
  let edited: number;

  async function create(initial: PhysiologicalProfile | null = null): Promise<void> {
    fixture = TestBed.createComponent(PhysiologicalForm);
    fixture.componentRef.setInput('initial', initial);
    fixture.componentRef.setInput('consentVersion', SIMULATED_HEALTH_CONSENT_VERSION);
    submitted = [];
    edited = 0;
    fixture.componentInstance.submitted.subscribe((draft) => submitted.push(draft));
    fixture.componentInstance.edited.subscribe(() => edited++);
    await fixture.whenStable();
    element = fixture.nativeElement as HTMLElement;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PhysiologicalForm],
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

  async function fill(values: Record<string, string>): Promise<void> {
    for (const [name, value] of Object.entries(values)) {
      type(name, value);
    }
    await fixture.whenStable();
  }

  async function acceptConsent(): Promise<void> {
    element.querySelector<HTMLInputElement>('mat-checkbox input')!.click();
    await fixture.whenStable();
  }

  async function submit(): Promise<void> {
    element.querySelector('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
  }

  function saveButton(): HTMLButtonElement {
    return [...element.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes('Guardar datos fisiológicos'),
    )!;
  }

  function errorOf(name: string): string {
    return (
      control(name).closest('mat-form-field')?.querySelector('mat-error')?.textContent?.trim() ?? ''
    );
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

  it('muestra los campos con sus unidades en la etiqueta y como sufijo', async () => {
    await create();

    const labels = [...element.querySelectorAll('mat-label')].map((label) =>
      label.textContent?.trim(),
    );
    expect(labels).toEqual([
      'Fecha y hora de la medición',
      'Peso (kg)',
      'Altura (cm)',
      'Frecuencia cardíaca en reposo (lpm, opcional)',
      'Temperatura corporal (°C, opcional)',
      'Presión sistólica (mmHg)',
      'Presión diastólica (mmHg)',
    ]);
    const suffixes = [...element.querySelectorAll('[matTextSuffix]')];
    expect(suffixes.map((item) => item.textContent?.trim())).toEqual([
      'kg',
      'cm',
      'lpm',
      '°C',
      'mmHg',
      'mmHg',
    ]);
    expect(suffixes.every((item) => item.getAttribute('aria-hidden') === 'true')).toBeTrue();
    expect(control('weightKg').getAttribute('inputmode')).toBe('decimal');
    expect(control('measuredAt').type).toBe('datetime-local');
    expect(element.querySelector('fieldset legend')?.textContent).toContain('Presión arterial');
    expect(element.textContent).not.toContain('IMC');
  });

  it('propone la hora actual como medición y la emite en UTC con segundos', async () => {
    const before = toLocalDateTimeInput(new Date());
    await create();
    const after = toLocalDateTimeInput(new Date());

    expect([before, after]).toContain(control('measuredAt').value);
    expect(element.textContent).toContain(Intl.DateTimeFormat().resolvedOptions().timeZone);

    await fill({ measuredAt: '2026-10-12T08:00', weightKg: '68,5', heightCm: '172' });
    await acceptConsent();
    await submit();

    expect(submitted.length).toBe(1);
    expect(submitted[0].measuredAt).toBe(localDateTimeToUtc('2026-10-12T08:00')!);
    expect(submitted[0].measuredAt).toMatch(MEASURED_AT_PATTERN);
  });

  it('CA3: mantiene deshabilitado «Guardar» hasta aceptar el consentimiento', async () => {
    await create();
    await fill({ weightKg: '68.5', heightCm: '172' });

    expect(element.querySelector('mat-checkbox')?.textContent).toContain(
      `(versión ${SIMULATED_HEALTH_CONSENT_VERSION})`,
    );
    expect(saveButton().disabled).toBeTrue();
    expect(testId('physiological-consent-required')?.textContent).toContain(
      'Marca la casilla de consentimiento',
    );
    expect(saveButton().getAttribute('aria-describedby')).toBe('physiological-consent-required');

    await acceptConsent();
    expect(saveButton().disabled).toBeFalse();
    expect(testId('physiological-consent-required')).toBeNull();
  });

  it('emite decimales como texto con punto y opcionales vacíos en null', async () => {
    await create();
    await fill({ weightKg: ' 68,5 ', heightCm: '172' });
    await acceptConsent();
    await submit();

    expect(submitted).toEqual([
      {
        consentVersion: SIMULATED_HEALTH_CONSENT_VERSION,
        measuredAt: jasmine.stringMatching(MEASURED_AT_PATTERN) as unknown as string,
        weightKg: '68.5',
        heightCm: 172,
        restingHeartRateBpm: null,
        bloodPressure: null,
        bodyTemperatureC: null,
      },
    ]);
  });

  it('emite todos los valores del ejemplo de ADR-034', async () => {
    await create();
    await fill({
      weightKg: '68.5',
      heightCm: '172',
      restingHeartRateBpm: '58',
      systolic: '118',
      diastolic: '76',
      bodyTemperatureC: '36,6',
    });
    await acceptConsent();
    await submit();

    expect(submitted[0]).toEqual(
      jasmine.objectContaining({
        weightKg: '68.5',
        heightCm: 172,
        restingHeartRateBpm: 58,
        bloodPressure: { systolic: 118, diastolic: 76 },
        bodyTemperatureC: '36.6',
      }),
    );
  });

  it('valida el formato y el rango de los decimales, con coma o punto', async () => {
    await create();
    await acceptConsent();

    await fill({ weightKg: '68,55', heightCm: '172' });
    await submit();
    expect(submitted).toEqual([]);
    expect(errorOf('weightKg')).toBe('Usa un número con un decimal como máximo, por ejemplo 68,5.');

    await fill({ weightKg: '19.9' });
    await submit();
    expect(errorOf('weightKg')).toBe('Debe estar entre 20,0 y 300,0.');

    await fill({ weightKg: '300,0', bodyTemperatureC: '42.1' });
    await submit();
    expect(errorOf('weightKg')).toBe('');
    expect(errorOf('bodyTemperatureC')).toBe('Debe estar entre 34,0 y 42,0.');

    await fill({ bodyTemperatureC: 'abc' });
    await submit();
    expect(errorOf('bodyTemperatureC')).toBe(
      'Usa un número con un decimal como máximo, por ejemplo 68,5.',
    );
    expect(submitted).toEqual([]);
  });

  it('valida enteros y los límites del contrato', async () => {
    await create();
    await acceptConsent();
    await fill({ weightKg: '68.5', heightCm: '172.5', restingHeartRateBpm: '221' });
    await submit();

    expect(submitted).toEqual([]);
    expect(errorOf('heightCm')).toBe('Ingresa un número entero.');
    expect(errorOf('restingHeartRateBpm')).toBe('El valor máximo permitido es 220.');

    await fill({ heightCm: '99', restingHeartRateBpm: '' });
    await submit();
    expect(errorOf('heightCm')).toBe('El valor mínimo permitido es 100.');
  });

  it('exige ambos valores de la presión si se registra uno', async () => {
    await create();
    await acceptConsent();
    await fill({ weightKg: '68.5', heightCm: '172', systolic: '118' });
    await submit();

    expect(submitted).toEqual([]);
    expect(errorOf('diastolic')).toBe('Indica la presión sistólica y la diastólica.');

    await fill({ diastolic: '76' });
    expect(errorOf('diastolic')).toBe('');
    await submit();
    expect(submitted[0].bloodPressure).toEqual({ systolic: 118, diastolic: 76 });
  });

  it('no valida en el cliente la coherencia de la presión: es regla del backend', async () => {
    await create();
    await acceptConsent();
    await fill({ weightKg: '68.5', heightCm: '172', systolic: '70', diastolic: '90' });
    await submit();

    expect(submitted[0].bloodPressure).toEqual({ systolic: 70, diastolic: 90 });
  });

  it('precarga la sección vigente con el separador del idioma y el consentimiento sin marcar', async () => {
    const before = toLocalDateTimeInput(new Date());
    await create(INITIAL);
    const after = toLocalDateTimeInput(new Date());

    // Reemplazar registra una medición nueva: se propone la hora actual, no la anterior.
    expect([before, after]).toContain(control('measuredAt').value);
    expect(control('weightKg').value).toBe('68,5');
    expect(control('bodyTemperatureC').value).toBe('36,6');
    expect(control('systolic').value).toBe('118');
    expect(element.querySelector<HTMLInputElement>('mat-checkbox input')!.checked).toBeFalse();
    expect(saveButton().disabled).toBeTrue();
    expect(edited).toBe(0);

    await acceptConsent();
    await submit();
    expect(submitted[0]).toEqual({
      consentVersion: SIMULATED_HEALTH_CONSENT_VERSION,
      measuredAt: localDateTimeToUtc(control('measuredAt').value)!,
      weightKg: '68.5',
      heightCm: 172,
      restingHeartRateBpm: 58,
      bloodPressure: { systolic: 118, diastolic: 76 },
      bodyTemperatureC: '36.6',
    });
  });

  it('CA2: marca los campos del 422 con un resumen enfocable; editar retira las marcas', async () => {
    await create(INITIAL);
    await acceptConsent();
    await setServerErrors([
      { field: 'weight_kg', issue: 'out_of_range' },
      { field: 'blood_pressure', issue: 'inconsistent_values' },
      { field: 'bmi', issue: 'field_not_allowed' },
    ]);

    const summary = testId('physiological-errors')!;
    expect(summary.getAttribute('role')).toBe('alert');
    expect(summary.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(summary);
    expect([...summary.querySelectorAll('li')].map((li) => li.textContent?.trim())).toEqual([
      'Peso (kg): El valor está fuera del rango permitido.',
      'Presión arterial (opcional): La presión sistólica debe ser mayor que la diastólica.',
      'Solicitud: Este dato no se puede enviar.',
    ]);
    expect(errorOf('weightKg')).toBe('El valor está fuera del rango permitido.');
    expect(errorOf('systolic')).toBe('La presión sistólica debe ser mayor que la diastólica.');
    expect(errorOf('diastolic')).toBe('La presión sistólica debe ser mayor que la diastólica.');
    await submit();
    expect(submitted).toEqual([]);

    await fill({ diastolic: '70' });
    expect(errorOf('weightKg')).toBe('');
    await submit();
    expect(submitted.length).toBe(1);
  });

  it('CA3: explica en el consentimiento la versión no vigente', async () => {
    await create();
    await fill({ weightKg: '68.5', heightCm: '172' });
    await acceptConsent();
    await setServerErrors([{ field: 'consent.version', issue: 'unsupported_consent_version' }]);

    const message = testId('physiological-consent-error')!;
    expect(message.getAttribute('role')).toBe('alert');
    expect(message.textContent).toContain('Recarga la página y acepta la versión actual');
    expect(testId('physiological-errors')?.textContent).toContain(
      'Consentimiento de datos de salud: La versión del consentimiento ya no está vigente.',
    );
  });
});
