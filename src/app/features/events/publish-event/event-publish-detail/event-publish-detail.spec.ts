import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, ParamMap, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';

import { toApiError } from '../../../../core/api/api-error';
import {
  EVENT_DETAIL_RESPONSES,
  eventDetail,
  organizerEvent,
  publishedEvent,
} from '../../../../../testing/bff-web/publish-event.fixtures';
import { provideTranslateTesting } from '../../../../../testing/translate-testing';
import { PublishEventGateway } from '../publish-event.gateway';
import {
  EventDetail,
  PublishOutcome,
  toEventDetail,
  toOrganizerEvent,
} from '../publish-event.model';
import { PublishedEventsStore } from '../published-events.store';
import { EventPublishDetail } from './event-publish-detail';

// Datos sintéticos de prueba, derivados de los fixtures del contrato bff-web 0.16.0.
const DRAFT: EventDetail = toEventDetail(EVENT_DETAIL_RESPONSES.draft.body);
const PUBLISHED_EVENT = toOrganizerEvent(publishedEvent(organizerEvent(0)));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function httpError(status: number, code: string): HttpErrorResponse {
  return new HttpErrorResponse({
    status,
    error: { code, message: 'simulado', correlation_id: 'ref-sintetica-24d', details: [] },
  });
}

function failed(status: number, code: string): PublishOutcome {
  return { kind: 'failed', error: toApiError(httpError(status, code)) };
}

describe('EventPublishDetail (HU024)', () => {
  let fixture: ComponentFixture<EventPublishDetail>;
  let element: HTMLElement;
  let loadEvent: jasmine.Spy;
  let publish: jasmine.Spy;
  let params: BehaviorSubject<ParamMap>;
  let store: PublishedEventsStore;

  async function create(): Promise<void> {
    fixture = TestBed.createComponent(EventPublishDetail);
    await fixture.whenStable();
    fixture.detectChanges();
    element = fixture.nativeElement as HTMLElement;
  }

  async function settle(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function button(text: string): HTMLButtonElement | undefined {
    return [...element.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.trim().startsWith(text),
    );
  }

  function byTestId(id: string): HTMLElement | null {
    return element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  }

  async function confirmPublication(): Promise<void> {
    button('Publicar')!.click();
    await settle();
    button('Confirmar publicación')!.click();
    await settle();
  }

  beforeEach(async () => {
    params = new BehaviorSubject(convertToParamMap({ eventId: DRAFT.id }));
    loadEvent = jasmine.createSpy('loadEvent').and.resolveTo(DRAFT);
    publish = jasmine
      .createSpy('publish')
      .and.resolveTo({ kind: 'published', event: PUBLISHED_EVENT, replayed: false });
    await TestBed.configureTestingModule({
      imports: [EventPublishDetail],
      providers: [
        provideRouter([]),
        provideTranslateTesting(),
        PublishedEventsStore,
        { provide: PublishEventGateway, useValue: { loadEvent, publish } },
        { provide: ActivatedRoute, useValue: { paramMap: params.asObservable() } },
      ],
    }).compileComponents();
    store = TestBed.inject(PublishedEventsStore);
  });

  it('muestra la carga mientras consulta el evento', async () => {
    loadEvent.and.returnValue(new Promise(() => undefined));
    await create();

    expect(byTestId('state-loading')).not.toBeNull();
  });

  it('muestra el borrador en la zona del navegador con la zona del evento visible', async () => {
    await create();

    expect(loadEvent).toHaveBeenCalledOnceWith(DRAFT.id);
    expect(byTestId('event-detail-name')?.textContent).toContain('Carrera 10K Bogotá');
    expect(byTestId('event-detail-status')?.textContent).toContain('Borrador');
    expect(byTestId('event-detail-starts-at')?.textContent).toContain('hora del evento:');
    expect(byTestId('event-detail-starts-at')?.textContent).toContain('(America/Bogota)');
    expect(byTestId('event-detail')?.textContent).toContain('Parque Metropolitano Simón Bolívar');
    expect(button('Publicar')).toBeDefined();
    expect(byTestId('event-starts-in-past')).toBeNull();
  });

  it('advierte, sin bloquear, cuando el inicio ya pasó', async () => {
    loadEvent.and.resolveTo({ ...DRAFT, startsAt: '2026-01-10T12:00:00Z' });
    await create();

    expect(byTestId('event-starts-in-past')?.textContent).toContain('ya pasó');
    expect(button('Publicar')).toBeDefined();
  });

  it('pide confirmación antes de publicar y permite cancelar', async () => {
    await create();

    button('Publicar')!.click();
    await settle();

    const confirm = byTestId('event-publish-confirm')!;
    expect(confirm.getAttribute('role')).toBe('group');
    expect(confirm.textContent).toContain('¿Publicar «Carrera 10K Bogotá»?');
    expect(document.activeElement).toBe(confirm.querySelector('h3'));
    expect(publish).not.toHaveBeenCalled();

    button('Cancelar')!.click();
    await settle();

    expect(byTestId('event-publish-confirm')).toBeNull();
    expect(publish).not.toHaveBeenCalled();
  });

  it('CA1: al confirmar publica con una clave UUID y muestra lo que confirmó el backend', async () => {
    await create();

    await confirmPublication();

    expect(publish).toHaveBeenCalledOnceWith(
      DRAFT.id,
      jasmine.stringMatching(UUID),
      jasmine.any(Function),
    );
    const result = byTestId('event-published')!;
    expect(result.getAttribute('role')).toBe('status');
    expect(result.textContent).toContain('Evento publicado');
    expect(byTestId('event-published-version')?.textContent).toContain('2');
    expect(byTestId('event-published-at')?.textContent).toContain('(America/Bogota)');
    expect(byTestId('event-detail-status')?.textContent).toContain('Publicado');
    expect(document.activeElement).toBe(result.querySelector('h3'));
    expect(button('Publicar')).toBeUndefined();
    expect(store.find(DRAFT.id)).toEqual(PUBLISHED_EVENT);
  });

  it('CA4: informa que la publicación ya estaba confirmada (Idempotent-Replayed)', async () => {
    publish.and.resolveTo({ kind: 'published', event: PUBLISHED_EVENT, replayed: true });
    await create();

    await confirmPublication();

    expect(byTestId('event-publish-replayed')).not.toBeNull();
  });

  it('no envía dos veces mientras la publicación está en curso', async () => {
    let finish!: (outcome: PublishOutcome) => void;
    publish.and.returnValue(new Promise((resolve) => (finish = resolve)));
    await create();
    button('Publicar')!.click();
    await settle();

    button('Confirmar publicación')!.click();
    fixture.detectChanges();
    expect(button('Publicando…')?.disabled).toBeTrue();
    button('Publicando…')!.click();

    finish({ kind: 'published', event: PUBLISHED_EVENT, replayed: false });
    await settle();
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('informa los reintentos automáticos en curso', async () => {
    let finish!: (outcome: PublishOutcome) => void;
    publish.and.callFake((_id: string, _key: string, onRetry: (attempt: number) => void) => {
      onRetry(2);
      return new Promise((resolve) => (finish = resolve));
    });
    await create();
    await confirmPublication();

    expect(byTestId('event-publish-retrying')?.textContent).toContain('2 de 3');
    finish({ kind: 'published', event: PUBLISHED_EVENT, replayed: false });
    await settle();
  });

  it('CA4: tras agotar los reintentos, reintentar usa la misma clave', async () => {
    publish.and.resolveTo(failed(503, 'upstream_unavailable'));
    await create();
    await confirmPublication();

    const error = byTestId('event-publish-error')!;
    expect(error.textContent).toContain('ref-sintetica-24d');
    expect(error.textContent).toContain('no se publicará dos veces');

    publish.and.resolveTo({ kind: 'published', event: PUBLISHED_EVENT, replayed: true });
    button('Confirmar publicación')!.click();
    await settle();

    expect(publish.calls.argsFor(1)[1]).toBe(publish.calls.argsFor(0)[1]);
    expect(byTestId('event-published')).not.toBeNull();
  });

  it('CA4: ante idempotency_key_reused informa y el siguiente intento usa otra clave', async () => {
    publish.and.resolveTo(failed(409, 'idempotency_key_reused'));
    await create();
    await confirmPublication();

    expect(byTestId('event-publish-error')?.textContent).toContain(
      'No pudimos confirmar esta publicación',
    );

    publish.and.resolveTo({ kind: 'published', event: PUBLISHED_EVENT, replayed: false });
    button('Confirmar publicación')!.click();
    await settle();

    expect(publish.calls.argsFor(1)[1]).not.toBe(publish.calls.argsFor(0)[1]);
  });

  it('CA2: un 422 lista los requisitos faltantes junto a cada campo y el evento sigue como borrador', async () => {
    publish.and.resolveTo({
      kind: 'invalid',
      violations: [
        { field: 'description', issue: 'invalid_length' },
        { field: 'location.city', issue: 'required' },
        { field: 'starts_at', issue: 'not_in_future' },
        { field: 'header.idempotency-key', issue: 'required' },
      ],
    });
    await create();
    await confirmPublication();

    const summary = byTestId('event-publish-violations')!;
    expect(summary.getAttribute('role')).toBe('alert');
    expect(document.activeElement).toBe(summary);
    expect([...summary.querySelectorAll('li')].map((item) => item.textContent?.trim())).toEqual([
      'Descripción: la longitud no es válida.',
      'Ciudad: es obligatorio.',
      'Fecha y hora de inicio: debe ser una fecha futura.',
      'Solicitud: es obligatorio.',
    ]);
    expect(summary.textContent).toContain('El evento sigue como borrador.');
    const inline = [...element.querySelectorAll('[data-testid="event-field-violation"]')].map(
      (item) => item.textContent?.trim(),
    );
    expect(inline).toEqual([
      'la longitud no es válida.',
      'es obligatorio.',
      'debe ser una fecha futura.',
    ]);
    expect(byTestId('event-detail-status')?.textContent).toContain('Borrador');
    expect(button('Publicar')).toBeDefined();
    expect(store.find(DRAFT.id)).toBeNull();
  });

  it('CA3: un evento ajeno o inexistente se informa sin datos ni reintento', async () => {
    loadEvent.and.rejectWith(httpError(404, 'event_not_found'));
    await create();

    expect(byTestId('event-not-found')?.textContent).toContain('no te pertenece');
    expect(byTestId('event-detail')).toBeNull();
    expect(element.querySelector('button')).toBeNull();
  });

  it('CA3: un 404 al publicar se informa sin presentarse como éxito', async () => {
    publish.and.resolveTo(failed(404, 'event_not_found'));
    await create();
    await confirmPublication();

    expect(byTestId('event-publish-error')?.textContent).toContain('no te pertenece');
    expect(byTestId('event-published')).toBeNull();
  });

  it('CA6: sin permiso para publicar se informa el rechazo', async () => {
    publish.and.resolveTo(failed(403, 'permission_required'));
    await create();
    await confirmPublication();

    expect(byTestId('event-publish-error')?.textContent).toContain('No tienes permiso');
    expect(byTestId('event-publish-error')?.textContent).not.toContain('dos veces');
  });

  it('un evento ya publicado no ofrece publicar', async () => {
    loadEvent.and.resolveTo(toEventDetail(eventDetail(organizerEvent(5, 'PUBLISHED'))));
    await create();

    expect(byTestId('event-detail-status')?.textContent).toContain('Publicado');
    expect(byTestId('event-already-published')).not.toBeNull();
    expect(button('Publicar')).toBeUndefined();
  });

  it('un fallo al consultar el evento es recuperable', async () => {
    loadEvent.and.rejectWith(httpError(503, 'upstream_unavailable'));
    await create();
    loadEvent.and.resolveTo(DRAFT);

    byTestId('state-error')!.querySelector<HTMLButtonElement>('button')!.click();
    await settle();

    expect(byTestId('event-detail-name')).not.toBeNull();
  });

  it('al cambiar de evento consulta el nuevo y descarta el resultado anterior', async () => {
    publish.and.resolveTo(failed(503, 'upstream_unavailable'));
    await create();
    await confirmPublication();
    const other = toEventDetail(eventDetail(organizerEvent(1)));
    loadEvent.and.resolveTo(other);

    params.next(convertToParamMap({ eventId: other.id }));
    await settle();

    expect(loadEvent.calls.mostRecent().args).toEqual([other.id]);
    expect(byTestId('event-detail-name')?.textContent).toContain('Evento sintético 2');
    expect(byTestId('event-publish-error')).toBeNull();
    expect(byTestId('event-publish-confirm')).toBeNull();
  });
});
