import { formatDate } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { LOCALE_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

import { provideTranslateTesting } from '../../../../../testing/translate-testing';
import { HealthHistoryGateway } from '../health-history.gateway';
import { HealthReport, HealthReportsPage, NO_HEALTH_FILTERS } from '../health-history.model';
import { HealthHistoryPage } from './health-history-page';

// Datos sintéticos de prueba.
const ATHLETE_ID = '5d1e7a3c-2b4f-4c6d-8e9f-0a1b2c3d4e5f';

function report(index: number, overrides: Partial<HealthReport> = {}): HealthReport {
  return {
    id: `9e1b3d5f-7a9c-4e1b-9d5f-${String(index).padStart(12, '0')}`,
    type: 'INJURY',
    bodyArea: 'KNEE',
    severity: 'MODERATE',
    occurredAt: new Date(Date.UTC(2026, 9, 20, 14, 30) - index * 86_400_000).toISOString(),
    expectedRecoveryDays: 7,
    status: 'OPEN',
    sessionId: null,
    ...overrides,
  };
}

function page(reports: HealthReport[], nextCursor: string | null = null): HealthReportsPage {
  return { reports, nextCursor };
}

function httpError(status: number, code: string): HttpErrorResponse {
  return new HttpErrorResponse({
    status,
    error: { code, message: 'simulado', correlation_id: 'ref-sintetica-12', details: [] },
  });
}

describe('HealthHistoryPage (HU012)', () => {
  let fixture: ComponentFixture<HealthHistoryPage>;
  let element: HTMLElement;
  let loadPage: jasmine.Spy;

  async function create(athleteId: string | null = null): Promise<void> {
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: {
        snapshot: { paramMap: convertToParamMap(athleteId ? { athleteId } : {}), data: {} },
      },
    });
    fixture = TestBed.createComponent(HealthHistoryPage);
    await fixture.whenStable();
    element = fixture.nativeElement as HTMLElement;
  }

  function rows(): string[] {
    return [...element.querySelectorAll('tbody tr')].map(
      (row) => row.getAttribute('data-report') ?? '',
    );
  }

  function cells(index = 0): string[] {
    return [...element.querySelectorAll('tbody tr')[index].querySelectorAll('td')].map(
      (cell) => cell.textContent?.trim() ?? '',
    );
  }

  function button(text: string): HTMLButtonElement | undefined {
    return [...element.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.trim().startsWith(text),
    );
  }

  async function settle(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function choose(selectIndex: number, text: string): Promise<void> {
    element.querySelectorAll<HTMLElement>('mat-select')[selectIndex].click();
    await settle();
    [...document.querySelectorAll<HTMLElement>('mat-option')]
      .find((option) => option.textContent?.trim() === text)!
      .click();
    await settle();
  }

  beforeEach(async () => {
    loadPage = jasmine.createSpy('loadPage').and.resolveTo(page([report(0), report(1)]));
    await TestBed.configureTestingModule({
      imports: [HealthHistoryPage],
      providers: [
        provideRouter([]),
        provideTranslateTesting(),
        { provide: HealthHistoryGateway, useValue: { loadPage } },
        { provide: ActivatedRoute, useValue: {} },
      ],
    }).compileComponents();
  });

  it('muestra la carga mientras consulta la primera página', async () => {
    loadPage.and.returnValue(new Promise(() => undefined));
    await create();

    expect(element.querySelector('[data-testid="state-loading"]')).not.toBeNull();
  });

  it('CA1: el deportista ve sus reportes en el orden del backend con los campos de ADR-037', async () => {
    const first = report(0, { sessionId: '5a7c9e1b-3d5f-4a7c-9e1b-000000000000' });
    loadPage.and.resolveTo(page([first, report(1, { expectedRecoveryDays: null })]));
    await create();

    expect(loadPage).toHaveBeenCalledOnceWith({ kind: 'own' }, NO_HEALTH_FILTERS, null);
    expect(element.querySelector('h1')?.textContent).toContain('Mi salud');
    expect(rows()).toEqual([first.id, report(1).id]);
    expect(cells(0)).toEqual([
      formatDate(first.occurredAt, 'medium', TestBed.inject(LOCALE_ID)),
      'Lesión',
      'Rodilla',
      'Moderada',
      '7 días',
      'Abierto',
      'Asociado a un entrenamiento',
    ]);
    expect(cells(1)[4]).toBe('Sin estimación');
    expect(cells(1)[6]).toBe('Sin entrenamiento asociado');
    const table = element.querySelector('table')!;
    expect(table.getAttribute('aria-label')).toBe(
      'Reportes de molestias, incapacidades o lesiones',
    );
    expect(table.querySelectorAll('th[scope="col"]').length).toBe(7);
    expect(element.querySelector('[data-testid="health-count"]')?.textContent).toContain(
      'Reportes mostrados: 2.',
    );
  });

  it('no muestra identificadores ni otros datos del perfil', async () => {
    const first = report(0, { sessionId: '5a7c9e1b-3d5f-4a7c-9e1b-000000000000' });
    loadPage.and.resolveTo(page([first]));
    await create();

    const text = element.querySelector('table')!.textContent ?? '';
    expect(text).not.toContain(first.id);
    expect(text).not.toContain(first.sessionId!);
  });

  it('muestra el aviso de sensibilidad sin presentar los reportes como diagnóstico', async () => {
    await create();

    const notice = element.querySelector('[data-testid="health-sensitivity-notice"]')!;
    expect(notice.getAttribute('role')).toBe('note');
    expect(notice.textContent).toContain('Información de salud sensible');
    expect(notice.textContent).toContain('no constituyen un diagnóstico médico');
    expect(element.querySelector('[data-testid="health-choose-athlete"]')).toBeNull();
  });

  it('CA1: aplica periodo, tipo y severidad, y vuelve a la primera página', async () => {
    await create();
    const from = element.querySelector<HTMLInputElement>('input[formcontrolname="from"]')!;
    from.value = '2026-10-01';
    from.dispatchEvent(new Event('input'));
    const to = element.querySelector<HTMLInputElement>('input[formcontrolname="to"]')!;
    to.value = '2026-10-20';
    to.dispatchEvent(new Event('input'));
    await choose(0, 'Molestia');
    await choose(1, 'Alta');
    loadPage.and.resolveTo(page([report(1)]));

    element.querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle();

    expect(loadPage.calls.mostRecent().args).toEqual([
      { kind: 'own' },
      { from: '2026-10-01', to: '2026-10-20', type: 'DISCOMFORT', severity: 'HIGH' },
      null,
    ]);
    expect(rows()).toEqual([report(1).id]);
  });

  it('los filtros ofrecen los catálogos cerrados del contrato con textos localizados', async () => {
    await create();
    element.querySelectorAll<HTMLElement>('mat-select')[0].click();
    await settle();

    expect(
      [...document.querySelectorAll('mat-option')].map((option) => option.textContent?.trim()),
    ).toEqual(['Todos los tipos', 'Molestia', 'Lesión', 'Incapacidad']);
  });

  it('CA4: sin reportes muestra el vacío explícito y mantiene los filtros', async () => {
    loadPage.and.resolveTo(page([]));
    await create();

    expect(element.querySelector('[data-testid="state-empty"]')?.textContent).toContain(
      'Aún no tienes reportes de molestias, incapacidades o lesiones.',
    );
    expect(element.querySelector('form')).not.toBeNull();
  });

  it('CA4: con filtros sin resultados lo distingue y «Limpiar» vuelve a consultar sin filtros', async () => {
    await create();
    loadPage.and.resolveTo(page([]));
    await choose(1, 'Baja');
    element.querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle();

    expect(element.querySelector('[data-testid="state-empty"]')?.textContent).toContain(
      'No hay reportes con estos filtros.',
    );

    loadPage.and.resolveTo(page([report(0)]));
    button('Limpiar')!.click();
    await settle();

    expect(loadPage.calls.mostRecent().args).toEqual([{ kind: 'own' }, NO_HEALTH_FILTERS, null]);
    expect(rows()).toEqual([report(0).id]);
  });

  it('CA6: «Cargar más» envía el cursor recibido y agrega la página sin reordenar', async () => {
    loadPage.and.resolveTo(page([report(0), report(1)], 'cursor-2'));
    await create();
    loadPage.and.resolveTo(page([report(2)], null));

    button('Cargar más')!.click();
    await settle();

    expect(loadPage.calls.mostRecent().args).toEqual([
      { kind: 'own' },
      NO_HEALTH_FILTERS,
      'cursor-2',
    ]);
    expect(rows()).toEqual([report(0).id, report(1).id, report(2).id]);
    expect(button('Cargar más')).toBeUndefined();
    expect(element.querySelector('[data-testid="health-count"]')?.textContent).toContain(
      'Reportes mostrados: 3.',
    );
    expect(document.activeElement).toBe(element.querySelectorAll('tbody tr')[2]);
  });

  it('CA6: si falla la página siguiente conserva lo cargado y reintenta con el mismo cursor', async () => {
    loadPage.and.resolveTo(page([report(0)], 'cursor-2'));
    await create();
    loadPage.and.rejectWith(httpError(422, 'validation_error'));

    button('Cargar más')!.click();
    await settle();

    expect(rows()).toEqual([report(0).id]);
    expect(element.querySelector('[data-testid="health-more-error"]')?.textContent).toContain(
      'ref-sintetica-12',
    );

    loadPage.and.resolveTo(page([report(1)], null));
    button('Reintentar')!.click();
    await settle();

    expect(loadPage.calls.mostRecent().args[2]).toBe('cursor-2');
    expect(rows()).toEqual([report(0).id, report(1).id]);
  });

  it('CA6: un periodo o filtro inválido (422) se explica junto a los filtros, sin datos', async () => {
    loadPage.and.rejectWith(httpError(422, 'validation_error'));
    await create();

    const error = element.querySelector('[data-testid="health-own-error"]')!;
    expect(error.getAttribute('role')).toBe('alert');
    expect(error.textContent).toContain('El periodo o los filtros no son válidos');
    expect(error.textContent).toContain('ref-sintetica-12');
    expect(element.querySelector('form')).not.toBeNull();
    expect(element.querySelector('table')).toBeNull();
  });

  it('una respuesta de una consulta anterior no pisa la vigente', async () => {
    let resolveOld!: (value: HealthReportsPage) => void;
    loadPage.and.returnValue(new Promise((resolve) => (resolveOld = resolve)));
    await create();
    loadPage.and.resolveTo(page([report(3)]));
    button('Limpiar')!.click();
    await settle();

    resolveOld(page([report(0)]));
    await settle();

    expect(rows()).toEqual([report(3).id]);
  });

  it('cambiar los filtros mientras carga la página siguiente no deja «Cargar más» bloqueado', async () => {
    loadPage.and.resolveTo(page([report(0)], 'cursor-2'));
    await create();
    let resolveMore!: (value: HealthReportsPage) => void;
    loadPage.and.returnValue(new Promise((resolve) => (resolveMore = resolve)));
    button('Cargar más')!.click();
    loadPage.and.resolveTo(page([report(3)], 'cursor-3'));
    button('Limpiar')!.click();
    await settle();

    resolveMore(page([report(1)]));
    await settle();

    expect(rows()).toEqual([report(3).id]);
    expect(button('Cargar más')?.disabled).toBeFalse();
  });

  it('un fallo del servicio es recuperable con referencia', async () => {
    loadPage.and.rejectWith(httpError(503, 'upstream_unavailable'));
    await create();

    const error = element.querySelector('[data-testid="state-error"]')!;
    expect(error.textContent).toContain('ref-sintetica-12');
    loadPage.and.resolveTo(page([report(0)]));
    error.querySelector<HTMLButtonElement>('button')!.click();
    await settle();

    expect(rows()).toEqual([report(0).id]);
  });

  it('sin conexión lo informa y permite reintentar; nunca como historial vacío', async () => {
    loadPage.and.rejectWith(new HttpErrorResponse({ status: 0 }));
    await create();

    const error = element.querySelector('[data-testid="state-error"]')!;
    expect(error.textContent).toContain('No hay conexión');
    expect(error.querySelector('button')).not.toBeNull();
    expect(element.querySelector('[data-testid="state-empty"]')).toBeNull();
  });

  describe('profesional', () => {
    it('CA2: consulta el historial del deportista de la ruta, con regreso al selector', async () => {
      await create(ATHLETE_ID);

      expect(loadPage).toHaveBeenCalledOnceWith(
        { kind: 'athlete', athleteId: ATHLETE_ID },
        NO_HEALTH_FILTERS,
        null,
      );
      expect(element.querySelector('h1')?.textContent).toContain(
        'Historial de salud del deportista',
      );
      expect(rows()).toEqual([report(0).id, report(1).id]);
      expect(
        element.querySelector('[data-testid="health-sensitivity-notice"]')?.textContent,
      ).toContain('mientras el deportista mantenga tu autorización');
      const choose = element.querySelector('[data-testid="health-choose-athlete"]');
      expect(choose?.textContent).toContain('Elegir otro deportista');
      expect(choose?.getAttribute('href')).toBe('/profesional/historial/salud');
    });

    it('CA4: el deportista sin reportes se informa como tal', async () => {
      loadPage.and.resolveTo(page([]));
      await create(ATHLETE_ID);

      expect(element.querySelector('[data-testid="state-empty"]')?.textContent).toContain(
        'Este deportista aún no tiene reportes',
      );
    });

    it('CA3: sin autorización vigente se rechaza sin datos ni revelar si el deportista existe', async () => {
      loadPage.and.rejectWith(httpError(403, 'athlete_authorization_required'));
      await create(ATHLETE_ID);

      const error = element.querySelector('[data-testid="health-own-error"]')!;
      expect(error.getAttribute('role')).toBe('alert');
      expect(error.textContent).toContain('no te ha autorizado o revocó la autorización');
      expect(error.querySelector('button')).toBeNull();
      expect(element.querySelector('table')).toBeNull();
    });

    it('CA3: sin permiso se explica con su propio mensaje, sin datos', async () => {
      loadPage.and.rejectWith(httpError(403, 'permission_required'));
      await create(ATHLETE_ID);

      expect(element.querySelector('[data-testid="health-own-error"]')?.textContent).toContain(
        'no tiene permiso para consultar historiales de salud',
      );
      expect(element.querySelector('table')).toBeNull();
    });
  });
});
