import { LOCALE_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { MatSelectHarness } from '@angular/material/select/testing';

import { VALID_PUBLISH_ROUTE_REQUEST } from '../../../../../testing/bff-web/routes.fixtures';
import { provideTranslateTesting } from '../../../../../testing/translate-testing';
import { DEFAULT_LANGUAGE } from '../../../../core/i18n/i18n.providers';
import { RouteDraft, RouteViolation } from '../routes.model';
import { RouteForm } from './route-form';

describe('RouteForm (HU026)', () => {
  let fixture: ComponentFixture<RouteForm>;
  let element: HTMLElement;
  let loader: HarnessLoader;
  let submitted: RouteDraft[];
  let edited: number;
  let cancelled: number;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RouteForm],
      providers: [provideTranslateTesting(), { provide: LOCALE_ID, useValue: DEFAULT_LANGUAGE }],
    }).compileComponents();
    fixture = TestBed.createComponent(RouteForm);
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

  async function choose(name: string, option: string): Promise<void> {
    const select = await loader.getHarness(
      MatSelectHarness.with({ selector: `[formcontrolname="${name}"]` }),
    );
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

  async function fillValid(): Promise<void> {
    type('[formcontrolname="name"]', '  Vuelta al Parque Simón Bolívar ');
    type('[formcontrolname="description"]', VALID_PUBLISH_ROUTE_REQUEST.description);
    await choose('sport', 'Carrera');
    type('[formcontrolname="distanceKm"]', '12,5');
    await choose('difficulty', 'Moderada');
    type('[formcontrolname="city"]', 'Bogotá');
    type('[formcontrolname="countryCode"]', 'co');
    type('[data-testid="route-start-point"] [formcontrolname="lat"]', '4.6584');
    type('[data-testid="route-start-point"] [formcontrolname="lng"]', '-74.0937');
    await fixture.whenStable();
  }

  it('CA1: envía la ruta normalizada: texto recortado, coma decimal y país en mayúsculas', async () => {
    await fillValid();
    button('Agregar punto intermedio')!.click();
    await fixture.whenStable();
    type('[data-waypoint="0"] [formcontrolname="lat"]', '4.6601');
    type('[data-waypoint="0"] [formcontrolname="lng"]', '-74.0902');
    await submit();

    expect(submitted).toEqual([
      {
        name: 'Vuelta al Parque Simón Bolívar',
        description: VALID_PUBLISH_ROUTE_REQUEST.description,
        sport: 'running',
        distanceKm: '12.5',
        difficulty: 'MODERATE',
        city: 'Bogotá',
        countryCode: 'CO',
        startPoint: { lat: 4.6584, lng: -74.0937 },
        waypoints: [{ lat: 4.6601, lng: -74.0902 }],
      },
    ]);
    expect(edited).toBeGreaterThan(0);
  });

  it('la descripción vacía y sin puntos intermedios viajan como null y lista vacía', async () => {
    await fillValid();
    type('[formcontrolname="description"]', '   ');
    await submit();

    expect(submitted[0]).toEqual(jasmine.objectContaining({ description: null, waypoints: [] }));
  });

  it('CA2: no envía una ruta incompleta y marca lo que falta', async () => {
    await submit();

    expect(submitted).toEqual([]);
    expect(element.querySelectorAll('mat-error').length).toBeGreaterThan(5);
  });

  it('CA2: valida la forma y el rango de la distancia y de las coordenadas', async () => {
    await fillValid();
    type('[formcontrolname="distanceKm"]', '12,55');
    await submit();
    expect(submitted).toEqual([]);
    expect(
      input('[formcontrolname="distanceKm"]').closest('mat-form-field')?.textContent,
    ).toContain('un decimal como máximo');

    type('[formcontrolname="distanceKm"]', '600');
    type('[data-testid="route-start-point"] [formcontrolname="lat"]', '91');
    await submit();
    expect(submitted).toEqual([]);
    expect(
      input('[formcontrolname="distanceKm"]').closest('mat-form-field')?.textContent,
    ).toContain('Debe estar entre 0,1 y 500,0 km');
    expect(
      input('[data-testid="route-start-point"] [formcontrolname="lat"]').closest('mat-form-field')
        ?.textContent,
    ).toContain('90');
  });

  it('el nombre respeta la longitud del contrato tras recortar', async () => {
    await fillValid();
    type('[formcontrolname="name"]', ' ab ');
    await submit();
    expect(submitted).toEqual([]);
    expect(input('[formcontrolname="name"]').closest('mat-form-field')?.textContent).toContain('3');

    type('[formcontrolname="name"]', 'x'.repeat(121));
    await submit();
    expect(submitted).toEqual([]);
    expect(input('[formcontrolname="name"]').closest('mat-form-field')?.textContent).toContain(
      '120',
    );
  });

  it('marca la longitud de inicio, el punto completo y deja solo en el resumen lo demás', async () => {
    await fillValid();
    button('Agregar punto intermedio')!.click();
    await fixture.whenStable();
    fixture.componentRef.setInput('serverErrors', [
      { field: 'start_point.lng', issue: 'out_of_range' },
      { field: 'waypoints[0]', issue: 'required' },
      { field: 'waypoints[5].lat', issue: 'out_of_range' },
      { field: 'waypoints', issue: 'too_many_items' },
    ] satisfies RouteViolation[]);
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();

    const field = (selector: string) =>
      input(selector).closest('mat-form-field')?.textContent ?? '';
    expect(field('[data-testid="route-start-point"] [formcontrolname="lng"]')).toContain(
      'fuera del rango permitido',
    );
    expect(field('[data-waypoint="0"] [formcontrolname="lat"]')).toContain(
      'Este dato es obligatorio.',
    );
    expect(byTestId('route-errors')?.textContent).toContain(
      'Puntos intermedios (opcionales): El valor no es válido.',
    );
    expect(byTestId('route-errors')?.querySelectorAll('li').length).toBe(4);
  });

  it('agrega y quita puntos intermedios con controles accesibles', async () => {
    button('Agregar punto intermedio')!.click();
    button('Agregar punto intermedio')!.click();
    await fixture.whenStable();

    expect(element.querySelectorAll('[data-waypoint]').length).toBe(2);
    expect(element.querySelector('[data-waypoint="1"]')?.getAttribute('aria-label')).toBe(
      'Punto intermedio 2',
    );
    element
      .querySelector<HTMLButtonElement>('[aria-label="Quitar el punto intermedio 1"]')!
      .click();
    await fixture.whenStable();
    expect(element.querySelectorAll('[data-waypoint]').length).toBe(1);
  });

  it('CA2: marca las reglas del backend en su campo y en su punto, y las resume', async () => {
    await fillValid();
    button('Agregar punto intermedio')!.click();
    button('Agregar punto intermedio')!.click();
    await fixture.whenStable();
    const violations: RouteViolation[] = [
      { field: 'distance_km', issue: 'out_of_range' },
      { field: 'country_code', issue: 'unknown_value' },
      { field: 'waypoints[1].lng', issue: 'out_of_range' },
      { field: 'organizer_id', issue: 'field_not_allowed' },
    ];
    fixture.componentRef.setInput('serverErrors', violations);
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();

    const summary = byTestId('route-errors')!;
    expect(document.activeElement).toBe(summary);
    expect([...summary.querySelectorAll('li')].map((li) => li.textContent?.trim())).toEqual([
      'Distancia (km): El valor está fuera del rango permitido.',
      'País (código ISO de 2 letras): El valor no es válido.',
      'Punto intermedio 2 (longitud): El valor está fuera del rango permitido.',
      'Solicitud: Este dato no se puede enviar.',
    ]);
    expect(
      element
        .querySelector('[data-waypoint="1"] [formcontrolname="lng"]')
        ?.closest('mat-form-field')?.textContent,
    ).toContain('fuera del rango permitido');
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
