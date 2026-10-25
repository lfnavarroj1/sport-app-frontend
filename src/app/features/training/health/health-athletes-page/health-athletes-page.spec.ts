import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { provideTranslateTesting } from '../../../../../testing/translate-testing';
import { AuthorizedAthletesGateway } from '../../history/authorized-athletes/authorized-athletes.gateway';
import {
  AuthorizedAthlete,
  AuthorizedAthletesPage as PageData,
} from '../../history/authorized-athletes/authorized-athletes.model';
import { HealthAthletesPage } from './health-athletes-page';

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
    error: { code, message: 'simulado', correlation_id: 'ref-sintetica-hu012', details: [] },
  });
}

describe('HealthAthletesPage (HU012, selector del profesional)', () => {
  let fixture: ComponentFixture<HealthAthletesPage>;
  let element: HTMLElement;
  let loadPage: jasmine.Spy;

  async function create(): Promise<void> {
    fixture = TestBed.createComponent(HealthAthletesPage);
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
      imports: [HealthAthletesPage],
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

  it('lista por nombre y correo a los deportistas que autorizaron; cada uno abre su historial de salud', async () => {
    await create();

    expect(loadPage).toHaveBeenCalledOnceWith(null);
    expect(element.querySelector('h1')?.textContent).toContain('Historial de molestias o lesiones');
    expect(items()).toEqual([athlete(0).id, athlete(1).id]);
    const link = element.querySelector<HTMLAnchorElement>('li[data-athlete] a')!;
    expect(link.textContent).toContain('Deportista Sintético 1');
    expect(link.textContent).toContain('deportista-1@example.com');
    expect(link.getAttribute('href')).toBe(`/${athlete(0).id}`);
    expect(
      element.querySelector('[data-testid="health-athletes-list"]')?.getAttribute('aria-label'),
    ).toBe('Deportistas que te autorizaron');
  });

  it('sin deportistas autorizados muestra el vacío explícito', async () => {
    loadPage.and.resolveTo(page([]));
    await create();

    expect(element.querySelector('[data-testid="state-empty"]')?.textContent).toContain(
      'Aún ningún deportista te ha autorizado',
    );
  });

  it('«Cargar más» usa el cursor recibido y agrega la página sin reordenar', async () => {
    loadPage.and.resolveTo(page([athlete(0)], 'cursor-2'));
    await create();
    loadPage.and.resolveTo(page([athlete(1)]));

    button('Cargar más')!.click();
    await settle();

    expect(loadPage.calls.mostRecent().args).toEqual(['cursor-2']);
    expect(items()).toEqual([athlete(0).id, athlete(1).id]);
    expect(button('Cargar más')).toBeUndefined();
    expect(document.activeElement).toBe(element.querySelectorAll('li[data-athlete] a')[1]);
  });

  it('si falla la página siguiente conserva lo cargado y permite reintentar', async () => {
    loadPage.and.resolveTo(page([athlete(0)], 'cursor-2'));
    await create();
    loadPage.and.rejectWith(httpError(503, 'upstream_unavailable'));

    button('Cargar más')!.click();
    await settle();

    expect(items()).toEqual([athlete(0).id]);
    expect(
      element.querySelector('[data-testid="health-athletes-more-error"]')?.textContent,
    ).toContain('ref-sintetica-hu012');
    expect(button('Reintentar')).toBeDefined();
  });

  it('sin training.history.view_assigned (403) se explica como falta de permiso, no como lista vacía', async () => {
    loadPage.and.rejectWith(httpError(403, 'permission_required'));
    await create();

    const error = element.querySelector('[data-testid="health-athletes-permission-denied"]')!;
    expect(error.getAttribute('role')).toBe('alert');
    expect(error.textContent).toContain('no tiene permiso');
    expect(element.querySelector('[data-testid="state-empty"]')).toBeNull();
  });

  it('un fallo del servicio es recuperable', async () => {
    loadPage.and.rejectWith(httpError(503, 'upstream_unavailable'));
    await create();
    loadPage.and.resolveTo(page([athlete(0)]));

    element.querySelector<HTMLButtonElement>('[data-testid="state-error"] button')!.click();
    await settle();

    expect(items()).toEqual([athlete(0).id]);
  });
});
