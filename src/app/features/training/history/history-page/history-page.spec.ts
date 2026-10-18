import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

import { provideTranslateTesting } from '../../../../../testing/translate-testing';
import { HistoryGateway } from '../history.gateway';
import { HistoryPage as HistoryPageData, HistorySession, NO_FILTERS } from '../history.model';
import { HistoryPage } from './history-page';

// Datos sintéticos de prueba.
const ATHLETE_ID = '5d1e7a3c-2b4f-4c6d-8e9f-0a1b2c3d4e5f';
const PLAN_ID = '3c5e7a9b-1d2f-4a6c-8e0b-2d4f6a8c0e1b';

function session(index: number, planId: string | null = null): HistorySession {
  const ended = Date.UTC(2026, 9, 12, 12) - index * 86_400_000;
  return {
    id: `5a7c9e1b-3d5f-4a7c-9e1b-${String(index).padStart(12, '0')}`,
    planId,
    sport: index % 2 === 0 ? 'running' : 'cycling',
    startedAt: new Date(ended - 2_700_000).toISOString(),
    endedAt: new Date(ended).toISOString(),
    durationSeconds: 2_700,
  };
}

function page(
  sessions: HistorySession[],
  nextCursor: string | null = null,
  availableSports: HistoryPageData['availableSports'] = ['running', 'cycling'],
): HistoryPageData {
  return { sessions, nextCursor, availableSports };
}

function httpError(status: number, code: string): HttpErrorResponse {
  return new HttpErrorResponse({
    status,
    error: { code, message: 'simulado', correlation_id: 'ref-sintetica-11', details: [] },
  });
}

describe('HistoryPage (HU011)', () => {
  let fixture: ComponentFixture<HistoryPage>;
  let element: HTMLElement;
  let loadPage: jasmine.Spy;

  async function create(athleteId: string | null = null): Promise<void> {
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: {
        snapshot: {
          paramMap: convertToParamMap(athleteId ? { athleteId } : {}),
          data: athleteId ? { planRoute: '/profesional/entrenamientos/planes' } : {},
        },
      },
    });
    fixture = TestBed.createComponent(HistoryPage);
    await fixture.whenStable();
    element = fixture.nativeElement as HTMLElement;
  }

  function rows(): string[] {
    return [...element.querySelectorAll('tbody tr')].map(
      (row) => row.getAttribute('data-session') ?? '',
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

  beforeEach(async () => {
    loadPage = jasmine.createSpy('loadPage').and.resolveTo(page([session(0), session(1)]));
    await TestBed.configureTestingModule({
      imports: [HistoryPage],
      providers: [
        provideRouter([]),
        provideTranslateTesting(),
        { provide: HistoryGateway, useValue: { loadPage } },
        { provide: ActivatedRoute, useValue: {} },
      ],
    }).compileComponents();
  });

  it('muestra la carga mientras consulta la primera página', async () => {
    loadPage.and.returnValue(new Promise(() => undefined));
    await create();

    expect(element.querySelector('[data-testid="state-loading"]')).not.toBeNull();
  });

  it('CA1: el deportista ve sus sesiones en el orden del backend', async () => {
    await create();

    expect(loadPage).toHaveBeenCalledOnceWith({ kind: 'own' }, NO_FILTERS, null);
    expect(element.querySelector('h1')?.textContent).toContain('Mi historial de entrenamiento');
    expect(rows()).toEqual([session(0).id, session(1).id]);
    expect(element.querySelector('tbody tr')?.textContent).toContain('Carrera');
    expect(element.querySelector('tbody tr')?.textContent).toContain('45 min');
    expect(element.querySelector('[data-testid="history-count"]')?.textContent).toContain(
      'Sesiones mostradas: 2.',
    );
    const table = element.querySelector('table')!;
    expect(table.getAttribute('aria-label')).toBe('Sesiones de entrenamiento terminadas');
    expect(table.querySelectorAll('th[scope="col"]').length).toBe(5);
  });

  it('CA1: aplica periodo y deporte, y vuelve a la primera página', async () => {
    await create();
    const from = element.querySelector<HTMLInputElement>('input[formcontrolname="from"]')!;
    from.value = '2026-10-01';
    from.dispatchEvent(new Event('input'));
    const to = element.querySelector<HTMLInputElement>('input[formcontrolname="to"]')!;
    to.value = '2026-10-12';
    to.dispatchEvent(new Event('input'));
    element.querySelector<HTMLElement>('mat-select')!.click();
    await settle();
    [...document.querySelectorAll<HTMLElement>('mat-option')]
      .find((option) => option.textContent?.includes('Ciclismo'))!
      .click();
    loadPage.and.resolveTo(page([session(1)]));

    element.querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle();

    expect(loadPage.calls.mostRecent().args).toEqual([
      { kind: 'own' },
      { from: '2026-10-01', to: '2026-10-12', sport: 'cycling' },
      null,
    ]);
    expect(rows()).toEqual([session(1).id]);
  });

  it('el selector de deporte ofrece los deportes que informa el backend', async () => {
    loadPage.and.resolveTo(page([session(0)], null, ['swimming']));
    await create();
    element.querySelector<HTMLElement>('mat-select')!.click();
    await settle();

    expect(
      [...document.querySelectorAll('mat-option')].map((option) => option.textContent?.trim()),
    ).toEqual(['Todos los deportes', 'Natación']);
  });

  it('CA2: sin historial muestra el estado vacío y mantiene los filtros disponibles', async () => {
    loadPage.and.resolveTo(page([], null, []));
    await create();

    expect(element.querySelector('[data-testid="state-empty"]')?.textContent).toContain(
      'Aún no tienes entrenamientos terminados.',
    );
    expect(element.querySelector('form')).not.toBeNull();
  });

  it('CA2: con filtros sin resultados lo distingue y «Limpiar» vuelve a consultar sin filtros', async () => {
    await create();
    loadPage.and.resolveTo(page([]));
    element.querySelector<HTMLElement>('mat-select')!.click();
    await settle();
    [...document.querySelectorAll<HTMLElement>('mat-option')]
      .find((option) => option.textContent?.includes('Carrera'))!
      .click();
    element.querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle();

    expect(element.querySelector('[data-testid="state-empty"]')?.textContent).toContain(
      'No hay entrenamientos terminados con estos filtros.',
    );

    loadPage.and.resolveTo(page([session(0)]));
    button('Limpiar')!.click();
    await settle();

    expect(loadPage.calls.mostRecent().args).toEqual([{ kind: 'own' }, NO_FILTERS, null]);
    expect(rows()).toEqual([session(0).id]);
  });

  it('CA4: «Cargar más» envía el cursor recibido y agrega la página sin reordenar', async () => {
    loadPage.and.resolveTo(page([session(0), session(1)], 'cursor-2'));
    await create();
    loadPage.and.resolveTo(page([session(2)], null));

    button('Cargar más')!.click();
    await settle();

    expect(loadPage.calls.mostRecent().args).toEqual([{ kind: 'own' }, NO_FILTERS, 'cursor-2']);
    expect(rows()).toEqual([session(0).id, session(1).id, session(2).id]);
    expect(button('Cargar más')).toBeUndefined();
    expect(element.querySelector('[data-testid="history-count"]')?.textContent).toContain(
      'Sesiones mostradas: 3.',
    );
    expect(document.activeElement).toBe(element.querySelectorAll('tbody tr button')[2]);
  });

  it('CA4: si falla la página siguiente conserva lo cargado y permite reintentar con el mismo cursor', async () => {
    loadPage.and.resolveTo(page([session(0)], 'cursor-2'));
    await create();
    loadPage.and.rejectWith(httpError(503, 'upstream_unavailable'));

    button('Cargar más')!.click();
    await settle();

    expect(rows()).toEqual([session(0).id]);
    expect(element.querySelector('[data-testid="history-more-error"]')?.textContent).toContain(
      'ref-sintetica-11',
    );

    loadPage.and.resolveTo(page([session(1)], null));
    button('Reintentar')!.click();
    await settle();

    expect(loadPage.calls.mostRecent().args[2]).toBe('cursor-2');
    expect(rows()).toEqual([session(0).id, session(1).id]);
  });

  it('una respuesta de una consulta anterior no pisa la vigente', async () => {
    let resolveOld!: (value: HistoryPageData) => void;
    loadPage.and.returnValue(new Promise((resolve) => (resolveOld = resolve)));
    await create();
    loadPage.and.resolveTo(page([session(3)]));
    button('Limpiar')!.click();
    await settle();

    resolveOld(page([session(0)]));
    await settle();

    expect(rows()).toEqual([session(3).id]);
  });

  it('cambiar los filtros mientras carga la página siguiente no deja «Cargar más» bloqueado', async () => {
    loadPage.and.resolveTo(page([session(0)], 'cursor-2'));
    await create();
    let resolveMore!: (value: HistoryPageData) => void;
    loadPage.and.returnValue(new Promise((resolve) => (resolveMore = resolve)));
    button('Cargar más')!.click();
    loadPage.and.resolveTo(page([session(3)], 'cursor-3'));
    button('Limpiar')!.click();
    await settle();

    resolveMore(page([session(1)]));
    await settle();

    expect(rows()).toEqual([session(3).id]);
    expect(button('Cargar más')?.disabled).toBeFalse();
  });

  it('muestra el detalle de la sesión elegida y lo oculta', async () => {
    await create();
    const detailButton = element.querySelector<HTMLButtonElement>('tbody tr button')!;
    expect(detailButton.getAttribute('aria-expanded')).toBe('false');
    expect(detailButton.getAttribute('aria-controls')).toBe('history-detail');

    detailButton.click();
    await settle();

    const detail = element.querySelector('[data-testid="history-detail"]')!;
    expect(detailButton.getAttribute('aria-expanded')).toBe('true');
    expect(detail.textContent).toContain('Detalle de la sesión');
    expect(detail.textContent).toContain('Inicio');
    expect(detail.textContent).toContain('Sin plan');

    detailButton.click();
    await settle();
    expect(detail.textContent?.trim()).toBe('');
  });

  it('el deportista ve que la sesión pertenece a un plan, sin enlace', async () => {
    loadPage.and.resolveTo(page([session(0, PLAN_ID)]));
    await create();
    element.querySelector<HTMLButtonElement>('tbody tr button')!.click();
    await settle();

    const detail = element.querySelector('[data-testid="history-detail"]')!;
    expect(detail.textContent).toContain('Parte de un plan');
    expect(detail.querySelector('a')).toBeNull();
  });

  describe('profesional', () => {
    it('CA1: consulta el historial del deportista de la ruta y enlaza el plan', async () => {
      loadPage.and.resolveTo(page([session(0, PLAN_ID)]));
      await create(ATHLETE_ID);

      expect(loadPage).toHaveBeenCalledOnceWith(
        { kind: 'athlete', athleteId: ATHLETE_ID },
        NO_FILTERS,
        null,
      );
      expect(element.querySelector('h1')?.textContent).toContain(
        'Historial de entrenamiento del deportista',
      );
      element.querySelector<HTMLButtonElement>('tbody tr button')!.click();
      await settle();
      expect(element.querySelector('[data-testid="history-detail"] a')?.getAttribute('href')).toBe(
        `/profesional/entrenamientos/planes/${PLAN_ID}`,
      );
    });

    it('CA2: el deportista sin historial se informa como tal', async () => {
      loadPage.and.resolveTo(page([], null, []));
      await create(ATHLETE_ID);

      expect(element.querySelector('[data-testid="state-empty"]')?.textContent).toContain(
        'Este deportista aún no tiene entrenamientos terminados.',
      );
    });

    it('CA3: sin relación vigente se rechaza sin mostrar datos ni reintento', async () => {
      loadPage.and.rejectWith(httpError(403, 'athlete_authorization_required'));
      await create(ATHLETE_ID);

      const error = element.querySelector('[data-testid="history-not-authorized"]')!;
      expect(error.getAttribute('role')).toBe('alert');
      expect(error.textContent).toContain('no te ha autorizado o revocó la autorización');
      expect(element.querySelector('table')).toBeNull();
      expect(error.querySelector('button')).toBeNull();
    });

    it('CA3: sin permiso se muestra el rechazo general', async () => {
      loadPage.and.rejectWith(httpError(403, 'permission_required'));
      await create(ATHLETE_ID);

      expect(element.querySelector('[data-testid="state-error"]')?.textContent).toContain(
        'No tienes permiso',
      );
      expect(element.querySelector('table')).toBeNull();
    });
  });

  it('un filtro inválido (422) se informa sin reintento automático', async () => {
    loadPage.and.rejectWith(httpError(422, 'validation_error'));
    await create();

    const error = element.querySelector('[data-testid="state-error"]')!;
    expect(error.textContent).toContain('Algunos datos no son válidos');
    expect(error.querySelector('button')).toBeNull();
  });

  it('un fallo del servicio es recuperable', async () => {
    loadPage.and.rejectWith(httpError(503, 'upstream_unavailable'));
    await create();
    loadPage.and.resolveTo(page([session(0)]));

    element.querySelector<HTMLButtonElement>('[data-testid="state-error"] button')!.click();
    await settle();

    expect(rows()).toEqual([session(0).id]);
  });
});
