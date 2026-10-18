import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { provideTranslateTesting } from '../../../../../../testing/translate-testing';
import { AuthorizedAthletesGateway } from '../authorized-athletes.gateway';
import {
  AuthorizedAthlete,
  AuthorizedAthletesPage as PageData,
} from '../authorized-athletes.model';
import { AuthorizedAthletesPage } from './authorized-athletes-page';

// Datos sintéticos de prueba.
function athlete(index: number): AuthorizedAthlete {
  return {
    id: `7b9d1f3a-5c7e-4b9d-8f1a-${String(index).padStart(12, '0')}`,
    fullName: `Deportista Sintético ${index + 1}`,
    email: `deportista-${index + 1}@example.com`,
    authorizedAt: new Date(Date.UTC(2026, 9, 10, 15) - index * 3_600_000).toISOString(),
  };
}

function page(athletes: AuthorizedAthlete[], nextCursor: string | null = null): PageData {
  return { athletes, nextCursor };
}

function httpError(status: number, code: string): HttpErrorResponse {
  return new HttpErrorResponse({
    status,
    error: { code, message: 'simulado', correlation_id: 'ref-sintetica-ca5', details: [] },
  });
}

describe('AuthorizedAthletesPage (HU011 CA5)', () => {
  let fixture: ComponentFixture<AuthorizedAthletesPage>;
  let element: HTMLElement;
  let loadPage: jasmine.Spy;

  async function create(): Promise<void> {
    fixture = TestBed.createComponent(AuthorizedAthletesPage);
    await fixture.whenStable();
    element = fixture.nativeElement as HTMLElement;
  }

  async function settle(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function items(): string[] {
    return [...element.querySelectorAll('li[data-athlete]')].map(
      (item) => item.getAttribute('data-athlete') ?? '',
    );
  }

  function button(text: string): HTMLButtonElement | undefined {
    return [...element.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.trim().startsWith(text),
    );
  }

  beforeEach(async () => {
    loadPage = jasmine.createSpy('loadPage').and.resolveTo(page([athlete(0), athlete(1)]));
    await TestBed.configureTestingModule({
      imports: [AuthorizedAthletesPage],
      providers: [
        provideRouter([]),
        provideTranslateTesting(),
        { provide: AuthorizedAthletesGateway, useValue: { loadPage } },
      ],
    }).compileComponents();
  });

  it('muestra la carga mientras consulta la primera página', async () => {
    loadPage.and.returnValue(new Promise(() => undefined));
    await create();

    expect(element.querySelector('[data-testid="state-loading"]')).not.toBeNull();
  });

  it('lista por nombre, correo y fecha de autorización, en el orden del backend', async () => {
    await create();

    expect(loadPage).toHaveBeenCalledOnceWith(null);
    expect(element.querySelector('h1')?.textContent).toContain('Historial de entrenamiento');
    expect(items()).toEqual([athlete(0).id, athlete(1).id]);
    const first = element.querySelector('li[data-athlete]')!;
    expect(first.textContent).toContain('Deportista Sintético 1');
    expect(first.textContent).toContain('deportista-1@example.com');
    expect(first.textContent).toContain('Te autorizó el');
    const list = element.querySelector('[data-testid="training-athletes-list"]')!;
    expect(list.tagName).toBe('UL');
    expect(list.getAttribute('aria-label')).toBe('Deportistas que te autorizaron');
    expect(element.querySelector('[data-testid="training-athletes-count"]')?.textContent).toContain(
      'Deportistas mostrados: 2.',
    );
  });

  it('cada deportista abre su historial por la ruta existente (`:athleteId`)', async () => {
    await create();

    const link = element.querySelector<HTMLAnchorElement>('li[data-athlete] a')!;
    expect(link.getAttribute('href')).toBe(`/${athlete(0).id}`);
  });

  it('no ofrece búsqueda ni ingreso de identificadores', async () => {
    await create();

    expect(element.querySelectorAll('input, textarea, select, mat-select').length).toBe(0);
  });

  it('sin autorizaciones vigentes muestra el estado vacío y el atajo desde un plan', async () => {
    loadPage.and.resolveTo(page([]));
    await create();

    expect(element.querySelector('[data-testid="state-empty"]')?.textContent).toContain(
      'Aún ningún deportista te ha autorizado',
    );
    expect(element.querySelector('[data-testid="training-athletes-list"]')).toBeNull();
    const shortcut = element.querySelector('[data-testid="training-athletes-shortcut"] a')!;
    expect(shortcut.getAttribute('href')).toBe('/profesional/entrenamientos/planes');
  });

  it('«Cargar más» envía el cursor recibido, agrega la página sin reordenar y mueve el foco', async () => {
    loadPage.and.resolveTo(page([athlete(0), athlete(1)], 'cursor-2'));
    await create();
    expect(element.querySelector('[data-testid="training-athletes-count"]')?.textContent).toContain(
      'Hay más disponibles',
    );
    loadPage.and.resolveTo(page([athlete(2)], null));

    button('Cargar más')!.click();
    await settle();

    expect(loadPage.calls.mostRecent().args).toEqual(['cursor-2']);
    expect(items()).toEqual([athlete(0).id, athlete(1).id, athlete(2).id]);
    expect(button('Cargar más')).toBeUndefined();
    expect(document.activeElement).toBe(element.querySelectorAll('li[data-athlete] a')[2]);
  });

  it('si falla la página siguiente conserva lo cargado y reintenta con el mismo cursor', async () => {
    loadPage.and.resolveTo(page([athlete(0)], 'cursor-2'));
    await create();
    loadPage.and.rejectWith(httpError(503, 'upstream_unavailable'));

    button('Cargar más')!.click();
    await settle();

    expect(items()).toEqual([athlete(0).id]);
    expect(
      element.querySelector('[data-testid="training-athletes-more-error"]')?.textContent,
    ).toContain('ref-sintetica-ca5');

    loadPage.and.resolveTo(page([athlete(1)], null));
    button('Reintentar')!.click();
    await settle();

    expect(loadPage.calls.mostRecent().args).toEqual(['cursor-2']);
    expect(items()).toEqual([athlete(0).id, athlete(1).id]);
  });

  it('un fallo del servicio (503: nombre y correo incompletos) es recuperable y no se presenta como lista vacía', async () => {
    loadPage.and.rejectWith(httpError(503, 'upstream_unavailable'));
    await create();

    const error = element.querySelector('[data-testid="state-error"]')!;
    expect(error.textContent).toContain('ref-sintetica-ca5');
    expect(element.querySelector('[data-testid="state-empty"]')).toBeNull();

    loadPage.and.resolveTo(page([athlete(0)]));
    error.querySelector<HTMLButtonElement>('button')!.click();
    await settle();

    expect(items()).toEqual([athlete(0).id]);
  });

  it('sin permiso se informa el rechazo sin reintento', async () => {
    loadPage.and.rejectWith(httpError(403, 'permission_required'));
    await create();

    const error = element.querySelector('[data-testid="state-error"]')!;
    expect(error.textContent).toContain('No tienes permiso');
    expect(error.querySelector('button')).toBeNull();
    expect(items()).toEqual([]);
  });

  it('una respuesta de una carga anterior no pisa la vigente', async () => {
    let resolveOld!: (value: PageData) => void;
    loadPage.and.returnValue(new Promise((resolve) => (resolveOld = resolve)));
    await create();
    loadPage.and.resolveTo(page([athlete(3)]));
    // Una carga nueva (como el reintento) reemplaza a la que sigue pendiente.
    await (fixture.componentInstance as unknown as { loadFirst(): Promise<void> }).loadFirst();
    await settle();

    resolveOld(page([athlete(0)]));
    await settle();

    expect(items()).toEqual([athlete(3).id]);
  });

  describe('una página siguiente que llega después de recargar la lista', () => {
    const reload = () =>
      (fixture.componentInstance as unknown as { loadFirst(): Promise<void> }).loadFirst();

    it('no se agrega a la lista nueva', async () => {
      loadPage.and.resolveTo(page([athlete(0)], 'cursor-2'));
      await create();
      let resolveMore!: (value: PageData) => void;
      loadPage.and.returnValue(new Promise((resolve) => (resolveMore = resolve)));
      button('Cargar más')!.click();
      loadPage.and.resolveTo(page([athlete(4)]));
      await reload();
      await settle();

      resolveMore(page([athlete(1)]));
      await settle();

      expect(items()).toEqual([athlete(4).id]);
    });

    it('si falla, su error no aparece en la lista nueva', async () => {
      loadPage.and.resolveTo(page([athlete(0)], 'cursor-2'));
      await create();
      let rejectMore!: (error: unknown) => void;
      loadPage.and.returnValue(new Promise((_, reject) => (rejectMore = reject)));
      button('Cargar más')!.click();
      loadPage.and.resolveTo(page([athlete(4)], 'cursor-3'));
      await reload();
      await settle();

      rejectMore(httpError(503, 'upstream_unavailable'));
      await settle();

      expect(items()).toEqual([athlete(4).id]);
      expect(element.querySelector('[data-testid="training-athletes-more-error"]')).toBeNull();
      expect(button('Cargar más')?.disabled).toBeFalse();
    });
  });

  it('sin conexión al pedir la página siguiente se informa sin referencia y se puede reintentar', async () => {
    loadPage.and.resolveTo(page([athlete(0)], 'cursor-2'));
    await create();
    loadPage.and.rejectWith(new HttpErrorResponse({ status: 0 }));

    button('Cargar más')!.click();
    await settle();

    const error = element.querySelector('[data-testid="training-athletes-more-error"]')!;
    expect(error.textContent).toContain('No hay conexión');
    expect(error.textContent).not.toContain('Código de referencia');
    expect(button('Reintentar')).toBeDefined();
  });
});
