import { LOCALE_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { provideTranslateTesting } from '../../../../../testing/translate-testing';
import { DEFAULT_LANGUAGE } from '../../../../core/i18n/i18n.providers';
import { EventDraft, EventViolation } from '../create-event.model';
import { browserTimeZone } from '../event-time';
import { CreateEventForm } from './create-event-form';

// Datos sintéticos de prueba (ejemplo de ADR-028).
const VALID: Record<string, string> = {
  name: '  Carrera 10K Bogotá ',
  discipline: 'Running',
  description: 'Carrera recreativa de diez kilómetros para corredores aficionados.',
  locationName: 'Parque Metropolitano Simón Bolívar',
  address: 'Avenida Calle 63 # 60-50',
  city: 'Bogotá',
  countryCode: 'co',
  startDate: '2026-11-15',
  startTime: '07:00',
  timeZone: 'America/Bogota',
  durationMinutes: '180',
  capacity: '5000',
};

describe('CreateEventForm (HU021)', () => {
  let fixture: ComponentFixture<CreateEventForm>;
  let element: HTMLElement;
  let submitted: EventDraft[];
  let edited: number;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CreateEventForm],
      providers: [provideTranslateTesting(), { provide: LOCALE_ID, useValue: DEFAULT_LANGUAGE }],
    }).compileComponents();
    fixture = TestBed.createComponent(CreateEventForm);
    submitted = [];
    edited = 0;
    fixture.componentInstance.submitted.subscribe((draft) => submitted.push(draft));
    fixture.componentInstance.edited.subscribe(() => edited++);
    await fixture.whenStable();
    element = fixture.nativeElement as HTMLElement;
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

  async function fill(values: Record<string, string> = VALID): Promise<void> {
    for (const [name, value] of Object.entries(values)) {
      type(name, value);
    }
    await fixture.whenStable();
  }

  async function submit(): Promise<void> {
    element.querySelector('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
  }

  function errors(): string[] {
    return [...element.querySelectorAll('mat-error')].map((item) => item.textContent?.trim() ?? '');
  }

  async function setServerErrors(violations: readonly EventViolation[]): Promise<void> {
    fixture.componentRef.setInput('serverErrors', violations);
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  }

  it('captura exactamente los campos de ADR-028, con la zona del navegador por defecto', () => {
    const names = [...element.querySelectorAll('[formcontrolname]')].map((item) =>
      item.getAttribute('formcontrolname'),
    );

    expect(names).toEqual([
      'name',
      'discipline',
      'description',
      'locationName',
      'address',
      'city',
      'countryCode',
      'startDate',
      'startTime',
      'timeZone',
      'durationMinutes',
      'capacity',
    ]);
    expect(control('timeZone').value).toBe(browserTimeZone());
    expect(element.textContent).not.toContain('Organizador');
  });

  it('no envía un formulario incompleto', async () => {
    type('timeZone', '');
    await submit();

    expect(submitted).toEqual([]);
    expect(errors()).toContain('Este campo es obligatorio.');
  });

  it('emite el borrador con textos recortados y el país en mayúsculas', async () => {
    await fill();

    expect(control('countryCode').value).toBe('CO');
    expect(element.querySelector('[data-testid="event-country-name"]')?.textContent).toContain(
      'Colombia',
    );
    await submit();

    expect(submitted).toEqual([
      {
        name: 'Carrera 10K Bogotá',
        description: VALID['description'],
        discipline: 'Running',
        location: {
          name: VALID['locationName'],
          address: VALID['address'],
          city: 'Bogotá',
          countryCode: 'CO',
        },
        startDate: '2026-11-15',
        startTime: '07:00',
        timeZone: 'America/Bogota',
        durationMinutes: 180,
        capacity: 5000,
      },
    ]);
    expect(edited).toBeGreaterThan(0);
  });

  it('mide las longitudes tras recortar, como el backend', async () => {
    await fill({ ...VALID, name: '  ab  ', description: 'corta' });
    await submit();

    expect(submitted).toEqual([]);
    expect(errors()).toContain('Debe tener al menos 3 caracteres.');
    expect(errors()).toContain('Debe tener al menos 20 caracteres.');
  });

  it('aplica los rangos y enteros del contrato', async () => {
    await fill({ ...VALID, durationMinutes: '10', capacity: '100001' });
    await submit();

    expect(submitted).toEqual([]);
    expect(errors()).toContain('El valor mínimo permitido es 15.');
    expect(errors()).toContain('El valor máximo permitido es 100000.');

    await fill({ ...VALID, capacity: '2.5' });
    await submit();
    expect(errors()).toContain('El valor no es válido.');
  });

  it('exige el patrón del país y una zona que el navegador conozca', async () => {
    await fill({ ...VALID, countryCode: 'C1', timeZone: 'Marte/Base' });
    await submit();

    expect(submitted).toEqual([]);
    expect(errors()).toContain('El formato no es válido.');
    expect(errors()).toContain('la zona horaria no es válida.');
  });

  it('CA3: lista las reglas del backend y marca los campos; editar retira las marcas', async () => {
    await fill();
    await setServerErrors([
      { field: 'starts_at', issue: 'not_in_future' },
      { field: 'location.country_code', issue: 'unknown_value' },
      { field: 'organizer_id', issue: 'field_not_allowed' },
    ]);

    const summary = element.querySelector<HTMLElement>('[data-testid="event-errors"]')!;
    expect(summary.getAttribute('role')).toBe('alert');
    expect(document.activeElement).toBe(summary);
    expect([...summary.querySelectorAll('li')].map((li) => li.textContent?.trim())).toEqual([
      'Fecha y hora de inicio: debe ser una fecha futura.',
      'País (código): el valor no es válido.',
      'Solicitud: no está permitido.',
    ]);
    expect(errors()).toContain('debe ser una fecha futura.');
    await submit();
    expect(submitted).toEqual([]);

    type('startDate', '2027-01-10');
    await fixture.whenStable();
    await submit();
    expect(submitted.length).toBe(1);
  });

  it('deshabilita el envío mientras se crea el evento', async () => {
    fixture.componentRef.setInput('submitting', true);
    await fill();
    await submit();

    const button = element.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(button.disabled).toBeTrue();
    expect(button.textContent).toContain('Creando…');
    expect(submitted).toEqual([]);
  });
});
