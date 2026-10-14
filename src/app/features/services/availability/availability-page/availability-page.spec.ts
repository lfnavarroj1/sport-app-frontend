import { HttpErrorResponse } from '@angular/common/http';
import { LOCALE_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';

import {
  SERVICES_AVAILABILITY_RESPONSES,
  catalogService,
} from '../../../../../testing/bff-web/services-availability.fixtures';
import { provideTranslateTesting } from '../../../../../testing/translate-testing';
import { ServiceAvailabilityResponseDto } from '../../../../core/api/bff-web/services-availability.api';
import { browserTimeZone, formatIntervalRange } from '../availability-format';
import { AvailabilityGateway } from '../availability.gateway';
import {
  AvailabilityFilters,
  AvailabilityPage as AvailabilityPageData,
  addDays,
  toAvailabilityPage,
} from '../availability.model';
import { AvailabilityPage } from './availability-page';

// Datos sintéticos de prueba, derivados de los fixtures del contrato bff-web 0.12.0.
const LOCALE = 'es';

function page(body: unknown): AvailabilityPageData {
  return toAvailabilityPage(body as ServiceAvailabilityResponseDto);
}

function pageOf(
  indexes: number[],
  nextCursor: string | null = null,
  restricted: string[] = ['SPORTS_MEDICINE'],
): AvailabilityPageData {
  return page({
    items: indexes.map((index) => catalogService(index)),
    next_cursor: nextCursor,
    restricted_categories: restricted,
  });
}

function serviceId(index: number): string {
  return catalogService(index).service_id;
}

function httpError(status: number, code: string): HttpErrorResponse {
  return new HttpErrorResponse({
    status,
    error: { code, message: 'simulado', correlation_id: 'ref-sintetica-20', details: [] },
  });
}

function defaultFilters(categories: AvailabilityFilters['categories'] = []): AvailabilityFilters {
  const today = new Date();
  return {
    fromDate: addDays(today, 0),
    toDate: addDays(today, 6),
    categories,
    modalities: [],
    includeUnavailable: false,
  };
}

describe('AvailabilityPage (HU020)', () => {
  let fixture: ComponentFixture<AvailabilityPage>;
  let element: HTMLElement;
  let loadPage: jasmine.Spy;

  async function create(data: Record<string, unknown> = {}): Promise<void> {
    TestBed.overrideProvider(ActivatedRoute, { useValue: { snapshot: { data } } });
    fixture = TestBed.createComponent(AvailabilityPage);
    await fixture.whenStable();
    fixture.detectChanges();
    element = fixture.nativeElement as HTMLElement;
  }

  async function settle(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function services(): string[] {
    return [...element.querySelectorAll('[data-testid="availability-list"] > li')].map(
      (item) => item.getAttribute('data-service') ?? '',
    );
  }

  function button(text: string): HTMLButtonElement | undefined {
    return [...element.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.trim().startsWith(text),
    );
  }

  function setDate(name: 'fromDate' | 'toDate', value: string): void {
    const input = element.querySelector<HTMLInputElement>(`input[formcontrolname="${name}"]`)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
  }

  function submit(): void {
    element.querySelector('form')!.dispatchEvent(new Event('submit'));
  }

  function text(testId: string): string {
    return element.querySelector(`[data-testid="${testId}"]`)?.textContent?.trim() ?? '';
  }

  beforeEach(async () => {
    loadPage = jasmine
      .createSpy('loadPage')
      .and.resolveTo(page(SERVICES_AVAILABILITY_RESPONSES.lastPage.body));
    await TestBed.configureTestingModule({
      imports: [AvailabilityPage],
      providers: [
        provideTranslateTesting(),
        { provide: LOCALE_ID, useValue: LOCALE },
        { provide: AvailabilityGateway, useValue: { loadPage } },
        { provide: ActivatedRoute, useValue: {} },
      ],
    }).compileComponents();
  });

  it('muestra la carga mientras consulta la primera página', async () => {
    loadPage.and.returnValue(new Promise(() => undefined));
    await create();

    expect(element.querySelector('[data-testid="state-loading"]')).not.toBeNull();
  });

  it('consulta por defecto hoy y los seis días siguientes, sin filtros', async () => {
    await create();

    expect(loadPage).toHaveBeenCalledOnceWith(defaultFilters(), null);
    expect(element.querySelector('h1')?.textContent).toContain('Servicios');
    expect(element.querySelector('h1')?.textContent).not.toContain('médicos');
    const from = element.querySelector<HTMLInputElement>('input[formcontrolname="fromDate"]')!;
    expect(from.value).toBe(defaultFilters().fromDate);
    const form = element.querySelector('[data-testid="availability-filters"]')!;
    expect(form.getAttribute('aria-label')).toBe('Filtros de servicios');
    expect(form.textContent).toContain(`(${browserTimeZone()})`);
    expect(form.textContent).toContain('Periodo de hasta 31 días');
  });

  it('la opción Premium abre la pantalla filtrada por medicina deportiva y «Limpiar» la conserva', async () => {
    loadPage.and.resolveTo(page(SERVICES_AVAILABILITY_RESPONSES.premium.body));
    await create({ presetCategory: 'SPORTS_MEDICINE' });

    expect(loadPage).toHaveBeenCalledOnceWith(defaultFilters(['SPORTS_MEDICINE']), null);
    expect(element.querySelector('h1')?.textContent).toContain('Servicios médicos y deportivos');
    expect(element.querySelector('[data-testid="availability-restricted"]')).toBeNull();

    button('Limpiar')!.click();
    await settle();

    expect(loadPage.calls.mostRecent().args).toEqual([defaultFilters(['SPORTS_MEDICINE']), null]);
  });

  it('CA1–CA3, CA6: lista los servicios con categoría, modalidad, tarifa informativa e intervalos', async () => {
    loadPage.and.resolveTo(page(SERVICES_AVAILABILITY_RESPONSES.firstPage.body));
    await create();

    expect(services()).toEqual([serviceId(0), serviceId(1), serviceId(2)]);
    const first = element.querySelector('[data-testid="availability-list"] > li')!;
    expect(first.querySelector('h2')?.textContent?.trim()).toBe(catalogService(0).name);
    expect(first.textContent).toContain('Entrenamiento');
    expect(first.textContent).toContain('Presencial');
    const price = first.querySelector('[data-testid="availability-price"]')!.textContent!;
    expect(price.replace(/\s+/g, ' ').trim()).toBe('$ 10.000 por sesión');
    expect(first.textContent).toContain('Tarifa informativa');

    const intervals = first.querySelectorAll('[data-testid="availability-intervals"] > li');
    expect(intervals.length).toBe(2);
    const interval = catalogService(0).availability[0];
    const shown = formatIntervalRange(interval.starts_at, interval.ends_at, LOCALE);
    expect(intervals[0].textContent).toContain(`${shown.start} – ${shown.end}`);
    expect(intervals[0].textContent).toContain('Cupo: 5');
    expect(intervals[1].textContent).toContain('Cupo: 1');
  });

  it('CA3: deja visible la zona del servicio solo si difiere de la del navegador', async () => {
    const own = catalogService(0);
    const other = catalogService(1);
    const browserZone = browserTimeZone();
    const foreignZone = browserZone === 'Pacific/Auckland' ? 'Europe/Madrid' : 'Pacific/Auckland';
    loadPage.and.resolveTo(
      page({
        items: [
          {
            ...own,
            availability: own.availability.map((i) => ({ ...i, time_zone: browserZone })),
          },
          {
            ...other,
            availability: other.availability.map((i) => ({ ...i, time_zone: foreignZone })),
          },
        ],
        next_cursor: null,
        restricted_categories: [],
      }),
    );
    await create();

    const [first, second] = element.querySelectorAll('[data-testid="availability-list"] > li');
    expect(first.textContent).not.toContain('Zona horaria del servicio');
    expect(second.textContent).toContain(`Zona horaria del servicio: ${foreignZone}`);
  });

  it('CA1: informa la categoría restringida como texto, sin enlace', async () => {
    loadPage.and.resolveTo(page(SERVICES_AVAILABILITY_RESPONSES.firstPage.body));
    await create();

    const note = element.querySelector('[data-testid="availability-restricted"]')!;
    expect(note.getAttribute('role')).toBe('note');
    expect(note.textContent).toContain('Medicina deportiva está disponible con el plan Premium');
    expect(note.querySelector('a')).toBeNull();
  });

  it('CA1: con el catálogo vacío muestra el vacío y también el aviso de restricción', async () => {
    loadPage.and.resolveTo(page(SERVICES_AVAILABILITY_RESPONSES.empty.body));
    await create();

    expect(text('state-empty')).toBe(
      'No hay servicios disponibles para este periodo y estos filtros.',
    );
    expect(element.querySelector('[data-testid="availability-restricted"]')).not.toBeNull();
    expect(element.querySelector('[data-testid="availability-list"]')).toBeNull();
  });

  it('CA2: aplica modalidad e «incluir sin espacios» y marca el servicio sin intervalos', async () => {
    await create();
    element.querySelectorAll<HTMLElement>('mat-select')[1].click();
    await settle();
    [...document.querySelectorAll<HTMLElement>('mat-option')]
      .find((option) => option.textContent?.includes('Virtual'))!
      .click();
    element.querySelector<HTMLInputElement>('mat-checkbox input')!.click();
    loadPage.and.resolveTo(page(SERVICES_AVAILABILITY_RESPONSES.withUnavailable.body));

    submit();
    await settle();

    expect(loadPage.calls.mostRecent().args).toEqual([
      { ...defaultFilters(), modalities: ['VIRTUAL'], includeUnavailable: true },
      null,
    ]);
    const items = element.querySelectorAll('[data-testid="availability-list"] > li');
    expect(items[0].querySelector('[data-testid="availability-unavailable"]')).toBeNull();
    expect(
      items[1].querySelector('[data-testid="availability-unavailable"]')?.textContent?.trim(),
    ).toBe('Sin espacios en el periodo');
    expect(items[1].querySelector('[data-testid="availability-intervals"]')).toBeNull();
  });

  it('un periodo de más de 31 días no consulta y explica el motivo', async () => {
    await create();
    const today = new Date();
    setDate('fromDate', addDays(today, 0));
    setDate('toDate', addDays(today, 31));
    await settle();

    submit();
    await settle();

    expect(loadPage).toHaveBeenCalledTimes(1);
    const error = element.querySelector('[data-testid="availability-period-error"]')!;
    expect(error.getAttribute('role')).toBe('alert');
    expect(error.textContent).toContain('El periodo no puede superar 31 días.');
  });

  it('un periodo de 31 días sí consulta', async () => {
    await create();
    const today = new Date();
    setDate('toDate', addDays(today, 30));

    submit();
    await settle();

    expect(loadPage).toHaveBeenCalledTimes(2);
    expect(loadPage.calls.mostRecent().args[0].toDate).toBe(addDays(today, 30));
    expect(element.querySelector('[data-testid="availability-period-error"]')).toBeNull();
  });

  it('una fecha final anterior a la inicial no consulta y explica el motivo', async () => {
    await create();
    const today = new Date();
    setDate('fromDate', addDays(today, 3));
    setDate('toDate', addDays(today, 1));

    submit();
    await settle();

    expect(loadPage).toHaveBeenCalledTimes(1);
    expect(text('availability-period-error')).toBe(
      'La fecha final no puede ser anterior a la inicial.',
    );
  });

  it('una fecha vacía no consulta y se marca como obligatoria', async () => {
    await create();
    setDate('fromDate', '');

    submit();
    await settle();

    expect(loadPage).toHaveBeenCalledTimes(1);
    expect(element.querySelector('mat-error')?.textContent).toContain('Este campo es obligatorio.');
  });

  it('CA4: «Cargar más» envía el cursor recibido, agrega sin reordenar y enfoca el primer servicio nuevo', async () => {
    loadPage.and.resolveTo(page(SERVICES_AVAILABILITY_RESPONSES.firstPage.body));
    await create();
    expect(text('availability-count')).toBe('Servicios mostrados: 3. Hay más disponibles.');
    loadPage.and.resolveTo(page(SERVICES_AVAILABILITY_RESPONSES.lastPage.body));

    button('Cargar más')!.click();
    await settle();

    expect(loadPage.calls.mostRecent().args).toEqual([
      defaultFilters(),
      'cursor-sintetico-servicios-2',
    ]);
    expect(services()).toEqual([serviceId(0), serviceId(1), serviceId(2), serviceId(3)]);
    expect(button('Cargar más')).toBeUndefined();
    expect(text('availability-count')).toBe('Servicios mostrados: 4.');
    expect(document.activeElement).toBe(
      element.querySelectorAll('[data-testid="availability-list"] > li > h2')[3],
    );
  });

  it('CA4: si falla la página siguiente conserva lo cargado y reintenta con el mismo cursor', async () => {
    loadPage.and.resolveTo(pageOf([0], 'cursor-2'));
    await create();
    loadPage.and.rejectWith(httpError(503, 'upstream_unavailable'));

    button('Cargar más')!.click();
    await settle();

    expect(services()).toEqual([serviceId(0)]);
    const error = element.querySelector('[data-testid="availability-more-error"]')!;
    expect(error.getAttribute('role')).toBe('alert');
    expect(error.textContent).toContain('ref-sintetica-20');

    loadPage.and.resolveTo(pageOf([1]));
    button('Reintentar')!.click();
    await settle();

    expect(loadPage.calls.mostRecent().args[1]).toBe('cursor-2');
    expect(services()).toEqual([serviceId(0), serviceId(1)]);
    expect(element.querySelector('[data-testid="availability-more-error"]')).toBeNull();
  });

  it('una respuesta de una consulta anterior no pisa la vigente', async () => {
    let resolveOld!: (value: AvailabilityPageData) => void;
    loadPage.and.returnValue(new Promise((resolve) => (resolveOld = resolve)));
    await create();
    loadPage.and.resolveTo(pageOf([3], null, []));
    button('Limpiar')!.click();
    await settle();

    resolveOld(pageOf([0]));
    await settle();

    expect(services()).toEqual([serviceId(3)]);
    expect(element.querySelector('[data-testid="availability-restricted"]')).toBeNull();
  });

  it('un 403 se informa sin reintento ni catálogo vacío', async () => {
    loadPage.and.rejectWith(httpError(403, 'permission_required'));
    await create();

    const error = element.querySelector('[data-testid="state-error"]')!;
    expect(error.textContent).toContain('No tienes permiso');
    expect(error.querySelector('button')).toBeNull();
    expect(element.querySelector('[data-testid="state-empty"]')).toBeNull();
    expect(element.querySelector('[data-testid="availability-list"]')).toBeNull();
  });

  it('un 503 es recuperable con «Reintentar»', async () => {
    loadPage.and.rejectWith(httpError(503, 'upstream_unavailable'));
    await create();
    expect(text('state-error')).toContain('ref-sintetica-20');
    loadPage.and.resolveTo(pageOf([0]));

    element.querySelector<HTMLButtonElement>('[data-testid="state-error"] button')!.click();
    await settle();

    expect(loadPage).toHaveBeenCalledTimes(2);
    expect(services()).toEqual([serviceId(0)]);
  });

  it('accesibilidad: lista etiquetada, nombres como encabezados y contador como estado', async () => {
    await create();

    const list = element.querySelector('[data-testid="availability-list"]')!;
    expect(list.tagName).toBe('UL');
    expect(list.getAttribute('aria-label')).toBe('Servicios disponibles');
    expect(list.querySelectorAll(':scope > li > h2').length).toBe(1);
    expect(element.querySelector('[data-testid="availability-count"]')?.getAttribute('role')).toBe(
      'status',
    );
  });
});
