import { LOCALE_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { MatSelectHarness } from '@angular/material/select/testing';

import { provideTranslateTesting } from '../../../../../testing/translate-testing';
import { DEFAULT_LANGUAGE } from '../../../../core/i18n/i18n.providers';
import { browserTimeZone } from '../../../events/create-event/event-time';
import { ServiceDraft, ServiceViolation } from '../create-service.model';
import { CreateServiceForm } from './create-service-form';

// Datos sintéticos de prueba (ejemplo de ADR-027).
const INTERVAL: Record<string, string> = {
  startDate: '2026-11-20',
  startTime: '09:00',
  endDate: '2026-11-20',
  endTime: '10:00',
  timeZone: 'America/Bogota',
  capacity: '1',
};

describe('CreateServiceForm (HU015)', () => {
  let fixture: ComponentFixture<CreateServiceForm>;
  let element: HTMLElement;
  let loader: HarnessLoader;
  let submitted: ServiceDraft[];
  let edited: number;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CreateServiceForm],
      providers: [provideTranslateTesting(), { provide: LOCALE_ID, useValue: DEFAULT_LANGUAGE }],
    }).compileComponents();
    fixture = TestBed.createComponent(CreateServiceForm);
    submitted = [];
    edited = 0;
    fixture.componentInstance.submitted.subscribe((draft) => submitted.push(draft));
    fixture.componentInstance.edited.subscribe(() => edited++);
    loader = TestbedHarnessEnvironment.loader(fixture);
    await fixture.whenStable();
    element = fixture.nativeElement as HTMLElement;
  });

  function input(name: string, scope: ParentNode = element): HTMLInputElement {
    return scope.querySelector<HTMLInputElement>(`[formcontrolname="${name}"]`)!;
  }

  function type(name: string, value: string, scope: ParentNode = element): void {
    const target = input(name, scope);
    target.value = value;
    target.dispatchEvent(new Event('input'));
    target.dispatchEvent(new Event('blur'));
  }

  function interval(index: number): HTMLElement {
    return element.querySelector<HTMLElement>(`[data-interval="${index}"]`)!;
  }

  async function choose(name: string, option: string): Promise<void> {
    const select = await loader.getHarness(
      MatSelectHarness.with({ selector: `[formcontrolname="${name}"]` }),
    );
    await select.open();
    await select.clickOptions({ text: option });
  }

  async function fillService(amount = '120000,50'): Promise<void> {
    type('name', '  Valoración deportiva inicial ');
    type('description', ' Valoración presencial para orientar el plan deportivo. ');
    type('amount', amount);
    await choose('category', 'Medicina deportiva');
    await choose('modality', 'Presencial');
    await choose('billingUnit', 'Por sesión');
    await fixture.whenStable();
  }

  async function addInterval(values: Record<string, string> = INTERVAL): Promise<void> {
    element.querySelector<HTMLButtonElement>('[data-testid="interval-add"]')!.click();
    await fixture.whenStable();
    const scope = interval(element.querySelectorAll('[data-testid="interval"]').length - 1);
    for (const [name, value] of Object.entries(values)) {
      type(name, value, scope);
    }
    await fixture.whenStable();
  }

  async function submit(): Promise<void> {
    element.querySelector('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
  }

  function errors(scope: ParentNode = element): string[] {
    return [...scope.querySelectorAll('mat-error')].map((item) => item.textContent?.trim() ?? '');
  }

  async function setServerErrors(violations: readonly ServiceViolation[]): Promise<void> {
    fixture.componentRef.setInput('serverErrors', violations);
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  }

  it('captura exactamente los campos de ADR-027, sin disponibilidad al empezar', () => {
    const names = [...element.querySelectorAll('[formcontrolname]')].map((item) =>
      item.getAttribute('formcontrolname'),
    );

    expect(names).toEqual([
      'name',
      'description',
      'category',
      'modality',
      'amount',
      'currency',
      'billingUnit',
    ]);
    expect(element.querySelector('[data-testid="interval-empty"]')?.textContent).toContain(
      'Puedes guardar el borrador sin disponibilidad',
    );
    expect(element.textContent).not.toContain('provider');
  });

  it('categoría, modalidad, moneda y unidad son controles cerrados del catálogo de ADR-027', async () => {
    const options = async (name: string) => {
      const select = await loader.getHarness(
        MatSelectHarness.with({ selector: `[formcontrolname="${name}"]` }),
      );
      await select.open();
      const texts = await Promise.all((await select.getOptions()).map((o) => o.getText()));
      await select.close();
      return texts;
    };

    expect(await options('category')).toEqual([
      'Medicina deportiva',
      'Entrenamiento',
      'Nutrición',
      'Transporte',
      'Acompañamiento',
    ]);
    expect(await options('modality')).toEqual(['Presencial', 'Virtual', 'Híbrida']);
    expect(await options('currency')).toEqual(['COP · Peso colombiano']);
    expect(await options('billingUnit')).toEqual([
      'Por servicio',
      'Por sesión',
      'Por hora',
      'Por día',
    ]);
  });

  it('no envía un formulario incompleto', async () => {
    await submit();

    expect(submitted).toEqual([]);
    expect(errors()).toContain('Este campo es obligatorio.');
  });

  it('CA1: emite el borrador con textos recortados y el importe como cadena con punto', async () => {
    await fillService();
    await submit();

    expect(submitted).toEqual([
      {
        name: 'Valoración deportiva inicial',
        description: 'Valoración presencial para orientar el plan deportivo.',
        category: 'SPORTS_MEDICINE',
        modality: 'IN_PERSON',
        amount: '120000.50',
        billingUnit: 'SESSION',
        intervals: [],
      },
    ]);
    expect(edited).toBeGreaterThan(0);
  });

  it('CA7: muestra la tarifa en es-CO solo como vista previa y aclara que no es un cobro', async () => {
    type('amount', '120000');
    await fixture.whenStable();
    const preview = element.querySelector('[data-testid="service-price-preview"]')!;

    expect(preview.textContent?.replace(/\s/g, ' ')).toContain('$ 120.000');
    expect(element.textContent).toContain('no genera cobros, facturas, pagos ni contrataciones');

    type('amount', '0');
    await fixture.whenStable();
    expect(preview.textContent).toContain('servicio gratuito');
  });

  it('CA3: rechaza más de dos decimales, separadores de miles y más de nueve cifras', async () => {
    for (const amount of ['10.123', '120.000,00', '1000000000', '-5', 'abc']) {
      await fillService(amount);
      await submit();

      expect(submitted).withContext(amount).toEqual([]);
      expect(errors()).toContain(
        'Usa un valor de hasta 9 cifras y 2 decimales, sin separadores de miles.',
      );
    }
  });

  it('mide las longitudes tras recortar, como el backend', async () => {
    await fillService();
    type('name', '  ab  ');
    type('description', 'corta');
    await submit();

    expect(submitted).toEqual([]);
    expect(errors()).toContain('Debe tener al menos 3 caracteres.');
    expect(errors()).toContain('Debe tener al menos 20 caracteres.');
  });

  it('CA6: agrega intervalos explícitos con la zona del navegador y emite cada uno', async () => {
    await fillService();
    element.querySelector<HTMLButtonElement>('[data-testid="interval-add"]')!.click();
    await fixture.whenStable();
    expect(input('timeZone', interval(0)).value).toBe(browserTimeZone());
    expect(interval(0).querySelector('legend')?.textContent).toContain('Horario 1');

    for (const [name, value] of Object.entries(INTERVAL)) {
      type(name, value, interval(0));
    }
    // Contiguo al anterior: lo decide el backend, el cliente no lo impide. La zona se
    // toma del intervalo anterior y la fecha de fin, de la de inicio.
    await addInterval({
      startDate: '2026-11-20',
      startTime: '10:00',
      endTime: '11:00',
      capacity: '1',
    });
    expect(input('timeZone', interval(1)).value).toBe('America/Bogota');
    expect(input('endDate', interval(1)).value).toBe('2026-11-20');
    await submit();

    expect(submitted[0].intervals).toEqual([
      {
        startDate: '2026-11-20',
        startTime: '09:00',
        endDate: '2026-11-20',
        endTime: '10:00',
        timeZone: 'America/Bogota',
        capacity: 1,
      },
      {
        startDate: '2026-11-20',
        startTime: '10:00',
        endDate: '2026-11-20',
        endTime: '11:00',
        timeZone: 'America/Bogota',
        capacity: 1,
      },
    ]);
  });

  it('CA6: aplica la capacidad de 1 a 100 y exige una zona que el navegador conozca', async () => {
    await fillService();
    await addInterval({ ...INTERVAL, capacity: '101', timeZone: 'Marte/Base' });
    await submit();

    expect(submitted).toEqual([]);
    expect(errors(interval(0))).toContain('El valor máximo permitido es 100.');
    expect(errors(interval(0))).toContain('la zona horaria no es válida.');

    type('capacity', '2.5', interval(0));
    await submit();
    expect(errors(interval(0))).toContain('Ingresa un número entero.');
  });

  it('CA6: permite quitar un intervalo y como máximo agrega 100', async () => {
    await addInterval();
    await addInterval();
    interval(0).querySelector<HTMLButtonElement>('[data-testid="interval-remove"]')!.click();
    await fixture.whenStable();
    expect(element.querySelectorAll('[data-testid="interval"]').length).toBe(1);

    const add = element.querySelector<HTMLButtonElement>('[data-testid="interval-add"]')!;
    for (let count = 1; count < 100; count++) {
      add.click();
    }
    await fixture.whenStable();

    expect(element.querySelectorAll('[data-testid="interval"]').length).toBe(100);
    expect(add.disabled).toBeTrue();
    expect(element.querySelector('[data-testid="interval-count"]')?.textContent).toContain(
      '100 de 100 horarios',
    );
  });

  it('CA3 y CA6: lista las reglas del backend, marca el campo del intervalo y editar retira las marcas', async () => {
    await fillService('120000');
    await addInterval();
    await addInterval({ ...INTERVAL, startTime: '09:30', endTime: '10:30' });
    await setServerErrors([
      { field: 'price.amount', issue: 'too_many_decimals' },
      { field: 'availability[1].starts_at', issue: 'overlapping_interval' },
      { field: 'availability[0].time_zone', issue: 'time_zone_offset_mismatch' },
      { field: 'provider_id', issue: 'field_not_allowed' },
    ]);

    const summary = element.querySelector<HTMLElement>('[data-testid="service-errors"]')!;
    expect(summary.getAttribute('role')).toBe('alert');
    expect(document.activeElement).toBe(summary);
    expect([...summary.querySelectorAll('li')].map((li) => li.textContent?.trim())).toEqual([
      'Valor: admite como máximo 2 decimales.',
      'Horario 2 · Inicio: se superpone con otro horario.',
      'Horario 1 · Zona horaria: la hora no existe o no coincide con la zona horaria en esa fecha.',
      'Solicitud: no está permitido.',
    ]);
    expect(errors(interval(1))).toContain('se superpone con otro horario.');
    expect(errors(interval(0))).toContain(
      'la hora no existe o no coincide con la zona horaria en esa fecha.',
    );
    await submit();
    expect(submitted).toEqual([]);

    type('startTime', '10:00', interval(1));
    await fixture.whenStable();
    await submit();
    expect(submitted.length).toBe(1);
  });

  it('cada intervalo es un grupo con nombre y su botón de quitar es explícito', async () => {
    await addInterval();

    const group = interval(0);
    expect(group.tagName).toBe('FIELDSET');
    expect(group.querySelector('legend')?.textContent?.trim()).toBe('Horario 1');
    expect(group.querySelector('[data-testid="interval-remove"]')?.textContent).toContain(
      'Quitar horario 1',
    );
    for (const name of ['startDate', 'startTime', 'endDate', 'endTime', 'timeZone', 'capacity']) {
      const field = input(name, group);
      expect(group.querySelector(`label[for="${field.id}"]`))
        .withContext(name)
        .not.toBeNull();
    }
  });

  it('deshabilita el envío mientras se guarda el borrador', async () => {
    fixture.componentRef.setInput('submitting', true);
    await fillService();
    await submit();

    const button = element.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(button.disabled).toBeTrue();
    expect(button.textContent).toContain('Guardando…');
    expect(submitted).toEqual([]);
  });
});
