import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { provideTranslateTesting } from '../../../../../../../testing/translate-testing';
import { AuthorizedAthletesGateway } from '../../../../history/authorized-athletes/authorized-athletes.gateway';
import { AuthorizedAthlete } from '../../../../history/authorized-athletes/authorized-athletes.model';
import { NutritionAthletesPage } from './nutrition-athletes-page';

// Datos sintéticos de prueba.
function athlete(index: number): AuthorizedAthlete {
  return {
    id: `6a2c4e8f-1b3d-4f5a-9c7e-${String(index).padStart(12, '0')}`,
    fullName: `Deportista Sintética ${index + 1}`,
    email: `deportista-${index + 1}@example.com`,
    authorizedAt: new Date(Date.UTC(2026, 9, 20, 15) - index * 3_600_000).toISOString(),
  };
}

function httpError(status: number, code: string): HttpErrorResponse {
  return new HttpErrorResponse({
    status,
    error: { code, message: 'simulado', correlation_id: 'ref-sintetica-hu013', details: [] },
  });
}

describe('NutritionAthletesPage (HU013)', () => {
  let fixture: ComponentFixture<NutritionAthletesPage>;
  let element: HTMLElement;
  let loadPage: jasmine.Spy;

  async function create(): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [NutritionAthletesPage],
      providers: [
        provideTranslateTesting(),
        provideRouter([]),
        { provide: AuthorizedAthletesGateway, useValue: { loadPage } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(NutritionAthletesPage);
    await settle();
    element = fixture.nativeElement as HTMLElement;
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function testId(id: string): HTMLElement | null {
    return element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  }

  function button(text: string): HTMLButtonElement | undefined {
    return [...element.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes(text),
    );
  }

  beforeEach(() => {
    loadPage = jasmine.createSpy('loadPage');
  });

  it('lista los deportistas que autorizaron al profesional y enlaza a sus consumos', async () => {
    loadPage.and.resolveTo({ athletes: [athlete(0), athlete(1)], nextCursor: null });
    await create();

    expect(element.querySelector('h1')?.textContent).toContain('Historial de alimentación');
    expect(loadPage).toHaveBeenCalledOnceWith(null);
    const links = [...element.querySelectorAll<HTMLAnchorElement>('[data-athlete] a')];
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      `/${athlete(0).id}`,
      `/${athlete(1).id}`,
    ]);
    expect(links[0].textContent).toContain('Deportista Sintética 1');
    expect(links[0].textContent).toContain('deportista-1@example.com');
    expect(testId('nutrition-athletes-list')?.getAttribute('aria-label')).toBe(
      'Deportistas que te autorizaron',
    );
  });

  it('sin autorizaciones muestra un vacío explícito', async () => {
    loadPage.and.resolveTo({ athletes: [], nextCursor: null });
    await create();

    expect(testId('state-empty')?.textContent).toContain(
      'Aún no tienes deportistas que te hayan autorizado',
    );
  });

  it('un 403 permission_required se explica como falta de permiso, no como lista vacía', async () => {
    loadPage.and.rejectWith(httpError(403, 'permission_required'));
    await create();

    expect(testId('nutrition-athletes-permission-denied')?.textContent).toContain(
      'no tiene permiso',
    );
    expect(testId('state-empty')).toBeNull();
    expect(testId('nutrition-athletes-list')).toBeNull();
  });

  it('un 503 es un error recuperable con referencia y reintento', async () => {
    loadPage.and.rejectWith(httpError(503, 'upstream_unavailable'));
    await create();

    expect(testId('state-error')?.textContent).toContain('ref-sintetica-hu013');
    loadPage.and.resolveTo({ athletes: [athlete(0)], nextCursor: null });
    button('Reintentar')!.click();
    await settle();

    expect(element.querySelectorAll('[data-athlete]').length).toBe(1);
  });

  it('carga la página siguiente con el cursor sin modificar y conserva la lista', async () => {
    loadPage.and.returnValues(
      Promise.resolve({ athletes: [athlete(0)], nextCursor: 'cursor+opaco/=' }),
      Promise.resolve({ athletes: [athlete(1)], nextCursor: null }),
    );
    await create();
    button('Cargar más')!.click();
    await settle();

    expect(loadPage.calls.argsFor(1)).toEqual(['cursor+opaco/=']);
    expect(element.querySelectorAll('[data-athlete]').length).toBe(2);
    expect(document.activeElement?.textContent).toContain('Deportista Sintética 2');
    expect(button('Cargar más')).toBeUndefined();
  });

  it('si falla la página siguiente conserva la lista y ofrece reintentar', async () => {
    loadPage.and.returnValues(
      Promise.resolve({ athletes: [athlete(0)], nextCursor: 'c1' }),
      Promise.reject(new HttpErrorResponse({ status: 0 })),
    );
    await create();
    button('Cargar más')!.click();
    await settle();

    expect(element.querySelectorAll('[data-athlete]').length).toBe(1);
    expect(testId('nutrition-athletes-more-error')?.textContent).toContain('No hay conexión');
    expect(button('Reintentar')).toBeDefined();
  });
});
