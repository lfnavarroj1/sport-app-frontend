import { HttpErrorResponse } from '@angular/common/http';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { ownService } from '../../../../../testing/bff-web/publish-service.fixtures';
import { provideTranslateTesting } from '../../../../../testing/translate-testing';
import { PublishServiceGateway } from '../publish-service.gateway';
import { OwnService, OwnServicesPage, toOwnService } from '../publish-service.model';
import { ServicePublicationsStore } from '../service-publications.store';
import { PublishServicesPage } from './publish-services-page';

// Datos sintéticos de prueba, derivados de los fixtures del contrato bff-web 0.16.0.
const draft = (index: number): OwnService => toOwnService(ownService(index));
const published = (index: number): OwnService => toOwnService(ownService(index, 'PUBLISHED'));

function page(services: OwnService[], nextCursor: string | null = null): OwnServicesPage {
  return { services, nextCursor };
}

function httpError(status: number, code: string): HttpErrorResponse {
  return new HttpErrorResponse({
    status,
    error: { code, message: 'simulado', correlation_id: 'ref-sintetica-19', details: [] },
  });
}

describe('PublishServicesPage (HU019)', () => {
  let fixture: ComponentFixture<PublishServicesPage>;
  let element: HTMLElement;
  let loadServices: jasmine.Spy;
  let store: ServicePublicationsStore;

  async function create(): Promise<void> {
    fixture = TestBed.createComponent(PublishServicesPage);
    await fixture.whenStable();
    element = fixture.nativeElement as HTMLElement;
  }

  async function settle(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function items(): string[] {
    return [...element.querySelectorAll('li[data-service]')].map(
      (item) => item.getAttribute('data-service') ?? '',
    );
  }

  function button(text: string): HTMLButtonElement | undefined {
    return [...element.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.trim().startsWith(text),
    );
  }

  async function openTab(testId: string): Promise<void> {
    element.querySelector<HTMLButtonElement>(`[data-testid="${testId}"] button`)!.click();
    await settle();
  }

  beforeEach(async () => {
    loadServices = jasmine.createSpy('loadServices').and.resolveTo(page([draft(0), draft(1)]));
    await TestBed.configureTestingModule({
      imports: [PublishServicesPage],
      providers: [
        provideRouter([]),
        provideTranslateTesting(),
        ServicePublicationsStore,
        { provide: PublishServiceGateway, useValue: { loadServices } },
      ],
    }).compileComponents();
    store = TestBed.inject(ServicePublicationsStore);
  });

  it('muestra la carga mientras consulta la primera página', async () => {
    loadServices.and.returnValue(new Promise(() => undefined));
    await create();

    expect(element.querySelector('[data-testid="state-loading"]')).not.toBeNull();
  });

  it('lista los borradores propios en el orden del backend, con tarifa y horarios futuros', async () => {
    await create();

    expect(loadServices).toHaveBeenCalledOnceWith('DRAFT', null);
    expect(element.querySelector('h1')?.textContent).toContain('Publicar servicios');
    expect(items()).toEqual([draft(0).id, draft(1).id]);
    const first = element.querySelector('li[data-service]')!;
    expect(first.textContent).toContain('Valoración deportiva inicial');
    expect(first.textContent).toContain('Medicina deportiva · Presencial');
    expect(first.textContent?.replace(/\s/g, ' ')).toContain('$ 120.000 por sesión');
    expect(first.textContent).toContain('Horarios futuros: 1');
    expect(first.querySelector('a')?.getAttribute('href')).toBe(`/${draft(0).id}`);
    const list = element.querySelector('[data-testid="own-services-list"]')!;
    expect(list.getAttribute('aria-label')).toBe('Servicios en borrador');
    expect(element.querySelector('mat-button-toggle-group')?.getAttribute('aria-label')).toBe(
      'Estado de los servicios',
    );
    expect(element.querySelector('[data-testid="own-services-count"]')?.textContent).toContain(
      'Servicios mostrados: 2.',
    );
    expect(element.querySelector('[data-testid="service-detail-placeholder"]')).not.toBeNull();
  });

  it('sin borradores muestra el estado vacío', async () => {
    loadServices.and.resolveTo(page([]));
    await create();

    expect(element.querySelector('[data-testid="state-empty"]')?.textContent).toContain(
      'No tienes servicios en borrador.',
    );
  });

  it('la pestaña de publicados consulta PUBLISHED y muestra la fecha de publicación', async () => {
    await create();
    loadServices.and.resolveTo(page([published(5)]));

    await openTab('services-tab-published');

    expect(loadServices).toHaveBeenCalledWith('PUBLISHED', null);
    expect(items()).toEqual([published(5).id]);
    expect(element.querySelector('li[data-service]')?.textContent).toContain('Publicado el');
    expect(
      element.querySelector('[data-testid="own-services-list"]')?.getAttribute('aria-label'),
    ).toBe('Servicios publicados');
  });

  it('un error de la lista se muestra con referencia y reintento, nunca como lista vacía', async () => {
    loadServices.and.rejectWith(httpError(503, 'upstream_unavailable'));
    await create();

    const error = element.querySelector('[data-testid="state-error"]')!;
    expect(error.textContent).toContain('ref-sintetica-19');
    expect(element.querySelector('[data-testid="state-empty"]')).toBeNull();

    loadServices.and.resolveTo(page([draft(0)]));
    button('Reintentar')!.click();
    await settle();
    expect(items()).toEqual([draft(0).id]);
  });

  it('«Cargar más» envía el cursor sin modificar y agrega la página siguiente', async () => {
    loadServices.and.resolveTo(page([draft(0), draft(1)], 'cursor-sintetico-servicios-2'));
    await create();
    loadServices.and.resolveTo(page([draft(2)]));

    button('Cargar más')!.click();
    await settle();

    expect(loadServices).toHaveBeenCalledWith('DRAFT', 'cursor-sintetico-servicios-2');
    expect(items()).toEqual([draft(0).id, draft(1).id, draft(2).id]);
    expect(button('Cargar más')).toBeUndefined();
    expect(element.querySelector('[data-testid="own-services-count"]')?.textContent).toContain(
      'Servicios mostrados: 3.',
    );
  });

  it('si falla la página siguiente conserva lo cargado y permite reintentar', async () => {
    loadServices.and.resolveTo(page([draft(0)], 'cursor-1'));
    await create();
    loadServices.and.rejectWith(httpError(504, 'upstream_timeout'));

    button('Cargar más')!.click();
    await settle();

    expect(items()).toEqual([draft(0).id]);
    expect(element.querySelector('[data-testid="own-services-more-error"]')).not.toBeNull();
    expect(button('Reintentar')).toBeDefined();
  });

  it('CA1: tras una publicación confirmada vuelve a consultar la pestaña vigente', async () => {
    await create();
    expect(loadServices).toHaveBeenCalledTimes(1);
    loadServices.and.resolveTo(page([draft(1)]));

    store.markPublished({
      id: draft(0).id,
      status: 'PUBLISHED',
      version: 2,
      publishedAt: '2026-10-22T15:00:00Z',
      updatedAt: '2026-10-22T15:00:00Z',
    });
    await settle();

    expect(loadServices).toHaveBeenCalledTimes(2);
    expect(items()).toEqual([draft(1).id]);
  });

  it('una respuesta tardía de otra pestaña no pisa la vigente', async () => {
    let lateDrafts!: (value: OwnServicesPage) => void;
    loadServices.and.returnValue(new Promise((resolve) => (lateDrafts = resolve)));
    await create();
    loadServices.and.resolveTo(page([published(5)]));
    await openTab('services-tab-published');

    lateDrafts(page([draft(0)]));
    await settle();

    expect(items()).toEqual([published(5).id]);
  });
});

@Component({ template: '<p data-testid="child-detail">detalle</p>' })
class ChildDetail {}

describe('PublishServicesPage con el detalle en la ruta hija (HU019)', () => {
  it('el aviso para elegir un servicio desaparece al abrir el detalle y vuelve al cerrarlo', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          {
            path: 'publicacion',
            component: PublishServicesPage,
            children: [{ path: ':serviceId', component: ChildDetail }],
          },
        ]),
        provideTranslateTesting(),
        ServicePublicationsStore,
        {
          provide: PublishServiceGateway,
          useValue: { loadServices: () => Promise.resolve(page([draft(0)])) },
        },
      ],
    });
    const harness = await RouterTestingHarness.create();

    await harness.navigateByUrl('/publicacion');
    expect(harness.routeNativeElement?.querySelector('[data-testid="service-detail-placeholder"]'))
      .withContext('sin servicio elegido')
      .not.toBeNull();

    await harness.navigateByUrl(`/publicacion/${draft(0).id}`);
    const root = harness.fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="child-detail"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="service-detail-placeholder"]')).toBeNull();
    expect(
      root.querySelector(`li[data-service="${draft(0).id}"] a`)?.getAttribute('aria-current'),
    ).toBe('page');

    await harness.navigateByUrl('/publicacion');
    expect(root.querySelector('[data-testid="service-detail-placeholder"]')).not.toBeNull();
  });
});
