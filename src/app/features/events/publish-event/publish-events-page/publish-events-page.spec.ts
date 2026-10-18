import { HttpErrorResponse } from '@angular/common/http';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import {
  organizerEvent,
  publishedEvent,
} from '../../../../../testing/bff-web/publish-event.fixtures';
import { provideTranslateTesting } from '../../../../../testing/translate-testing';
import { PublishEventGateway } from '../publish-event.gateway';
import { OrganizerEvent, OrganizerEventsPage, toOrganizerEvent } from '../publish-event.model';
import { PublishedEventsStore } from '../published-events.store';
import { PublishEventsPage } from './publish-events-page';

// Datos sintéticos de prueba, derivados de los fixtures del contrato bff-web 0.16.0.
const draft = (index: number): OrganizerEvent => toOrganizerEvent(organizerEvent(index));
const published = (index: number): OrganizerEvent =>
  toOrganizerEvent(organizerEvent(index, 'PUBLISHED'));

function page(events: OrganizerEvent[], nextCursor: string | null = null): OrganizerEventsPage {
  return { events, nextCursor };
}

function httpError(status: number, code: string): HttpErrorResponse {
  return new HttpErrorResponse({
    status,
    error: { code, message: 'simulado', correlation_id: 'ref-sintetica-24', details: [] },
  });
}

describe('PublishEventsPage (HU024)', () => {
  let fixture: ComponentFixture<PublishEventsPage>;
  let element: HTMLElement;
  let loadEvents: jasmine.Spy;
  let store: PublishedEventsStore;

  async function create(): Promise<void> {
    fixture = TestBed.createComponent(PublishEventsPage);
    await fixture.whenStable();
    element = fixture.nativeElement as HTMLElement;
  }

  async function settle(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function items(): string[] {
    return [...element.querySelectorAll('li[data-event]')].map(
      (item) => item.getAttribute('data-event') ?? '',
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
    loadEvents = jasmine.createSpy('loadEvents').and.resolveTo(page([draft(0), draft(1)]));
    await TestBed.configureTestingModule({
      imports: [PublishEventsPage],
      providers: [
        provideRouter([]),
        provideTranslateTesting(),
        PublishedEventsStore,
        { provide: PublishEventGateway, useValue: { loadEvents } },
      ],
    }).compileComponents();
    store = TestBed.inject(PublishedEventsStore);
  });

  it('muestra la carga mientras consulta la primera página', async () => {
    loadEvents.and.returnValue(new Promise(() => undefined));
    await create();

    expect(element.querySelector('[data-testid="state-loading"]')).not.toBeNull();
  });

  it('CA6: lista los borradores propios en el orden del backend, con la zona del evento visible', async () => {
    await create();

    expect(loadEvents).toHaveBeenCalledOnceWith('DRAFT', null);
    expect(element.querySelector('h1')?.textContent).toContain('Publicar eventos');
    expect(items()).toEqual([draft(0).id, draft(1).id]);
    const first = element.querySelector('li[data-event]')!;
    expect(first.textContent).toContain('Carrera 10K Bogotá');
    expect(first.textContent).toContain('Running · Bogotá');
    expect(first.textContent).toContain('Inicio en tu hora:');
    expect(first.textContent).toContain('Hora del evento:');
    expect(first.textContent).toContain('(America/Bogota)');
    expect(first.querySelector('a')?.getAttribute('href')).toBe(`/${draft(0).id}`);
    const list = element.querySelector('[data-testid="organizer-events-list"]')!;
    expect(list.getAttribute('aria-label')).toBe('Eventos en borrador');
    expect(element.querySelector('mat-button-toggle-group')?.getAttribute('aria-label')).toBe(
      'Estado de los eventos',
    );
    expect(element.querySelector('[data-testid="organizer-events-count"]')?.textContent).toContain(
      'Eventos mostrados: 2.',
    );
    expect(element.querySelector('[data-testid="event-detail-placeholder"]')).not.toBeNull();
  });

  it('sin borradores muestra el estado vacío', async () => {
    loadEvents.and.resolveTo(page([]));
    await create();

    expect(element.querySelector('[data-testid="state-empty"]')?.textContent).toContain(
      'No tienes eventos en borrador.',
    );
  });

  it('CA6: la pestaña de publicados consulta ese estado y muestra published_at', async () => {
    await create();
    loadEvents.and.resolveTo(page([published(5)]));

    await openTab('events-tab-published');

    expect(loadEvents.calls.mostRecent().args).toEqual(['PUBLISHED', null]);
    expect(items()).toEqual([published(5).id]);
    expect(element.querySelector('li[data-event]')?.textContent).toContain('Publicado el');
    expect(
      element.querySelector('[data-testid="organizer-events-list"]')?.getAttribute('aria-label'),
    ).toBe('Eventos publicados');
  });

  it('CA1: un evento publicado en la visita sale de borradores y aparece en publicados sin esperar la proyección', async () => {
    await create();
    store.markPublished(toOrganizerEvent(publishedEvent(organizerEvent(0))));
    await settle();

    expect(items()).toEqual([draft(1).id]);

    // La proyección aún no lo incluye: se muestra con la respuesta del comando.
    loadEvents.and.resolveTo(page([published(5)]));
    await openTab('events-tab-published');

    expect(items()).toEqual([draft(0).id, published(5).id]);
    expect(element.querySelectorAll('[data-testid="event-recently-published"]').length).toBe(1);

    // Cuando la proyección ya lo incluye, no se repite.
    loadEvents.and.resolveTo(page([published(0), published(5)]));
    await openTab('events-tab-draft');
    await openTab('events-tab-published');

    expect(items()).toEqual([published(0).id, published(5).id]);
    expect(element.querySelector('[data-testid="event-recently-published"]')).toBeNull();
  });

  it('«Cargar más» envía el cursor recibido, agrega la página y mueve el foco', async () => {
    loadEvents.and.resolveTo(page([draft(0), draft(1)], 'cursor-2'));
    await create();
    expect(element.querySelector('[data-testid="organizer-events-count"]')?.textContent).toContain(
      'Hay más disponibles',
    );
    loadEvents.and.resolveTo(page([draft(2)]));

    button('Cargar más')!.click();
    await settle();

    expect(loadEvents.calls.mostRecent().args).toEqual(['DRAFT', 'cursor-2']);
    expect(items()).toEqual([draft(0).id, draft(1).id, draft(2).id]);
    expect(button('Cargar más')).toBeUndefined();
    expect(document.activeElement).toBe(element.querySelectorAll('li[data-event] a')[2]);
  });

  it('si falla la página siguiente conserva lo cargado y reintenta con el mismo cursor', async () => {
    loadEvents.and.resolveTo(page([draft(0)], 'cursor-2'));
    await create();
    loadEvents.and.rejectWith(httpError(503, 'upstream_unavailable'));

    button('Cargar más')!.click();
    await settle();

    expect(items()).toEqual([draft(0).id]);
    expect(
      element.querySelector('[data-testid="organizer-events-more-error"]')?.textContent,
    ).toContain('ref-sintetica-24');

    loadEvents.and.resolveTo(page([draft(1)]));
    button('Reintentar')!.click();
    await settle();

    expect(loadEvents.calls.mostRecent().args).toEqual(['DRAFT', 'cursor-2']);
    expect(items()).toEqual([draft(0).id, draft(1).id]);
  });

  it('un fallo del servicio es recuperable y no se presenta como lista vacía', async () => {
    loadEvents.and.rejectWith(httpError(503, 'upstream_unavailable'));
    await create();

    const error = element.querySelector('[data-testid="state-error"]')!;
    expect(error.textContent).toContain('ref-sintetica-24');
    expect(element.querySelector('[data-testid="state-empty"]')).toBeNull();

    loadEvents.and.resolveTo(page([draft(0)]));
    error.querySelector<HTMLButtonElement>('button')!.click();
    await settle();

    expect(items()).toEqual([draft(0).id]);
  });

  it('CA6: sin permiso se informa el rechazo sin reintento', async () => {
    loadEvents.and.rejectWith(httpError(403, 'permission_required'));
    await create();

    const error = element.querySelector('[data-testid="state-error"]')!;
    expect(error.textContent).toContain('No tienes permiso');
    expect(error.querySelector('button')).toBeNull();
  });

  it('una respuesta de otra pestaña no pisa la vigente', async () => {
    let resolveDrafts!: (value: OrganizerEventsPage) => void;
    loadEvents.and.returnValue(new Promise((resolve) => (resolveDrafts = resolve)));
    await create();
    loadEvents.and.resolveTo(page([published(5)]));
    await openTab('events-tab-published');

    resolveDrafts(page([draft(0)]));
    await settle();

    expect(items()).toEqual([published(5).id]);
  });
});

@Component({ template: '<p data-testid="child-detail">detalle</p>' })
class ChildDetail {}

describe('PublishEventsPage con el detalle en la ruta hija (HU024)', () => {
  it('el aviso para elegir un evento desaparece al abrir el detalle y vuelve al cerrarlo', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          {
            path: 'publicacion',
            component: PublishEventsPage,
            children: [{ path: ':eventId', component: ChildDetail }],
          },
        ]),
        provideTranslateTesting(),
        PublishedEventsStore,
        {
          provide: PublishEventGateway,
          useValue: { loadEvents: () => Promise.resolve({ events: [draft(0)], nextCursor: null }) },
        },
      ],
    });
    const harness = await RouterTestingHarness.create();

    await harness.navigateByUrl('/publicacion');
    expect(harness.routeNativeElement?.querySelector('[data-testid="event-detail-placeholder"]'))
      .withContext('sin evento elegido')
      .not.toBeNull();

    await harness.navigateByUrl(`/publicacion/${draft(0).id}`);
    const root = harness.fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="child-detail"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="event-detail-placeholder"]')).toBeNull();
    expect(
      root.querySelector(`li[data-event="${draft(0).id}"] a`)?.getAttribute('aria-current'),
    ).toBe('page');

    await harness.navigateByUrl('/publicacion');
    expect(root.querySelector('[data-testid="event-detail-placeholder"]')).not.toBeNull();
  });
});
