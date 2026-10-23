import { HttpErrorResponse } from '@angular/common/http';
import { LOCALE_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, ParamMap, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';

import { toApiError } from '../../../../core/api/api-error';
import { DEFAULT_LANGUAGE } from '../../../../core/i18n/i18n.providers';
import {
  MY_SERVICE_RESPONSES,
  PUBLISH_SERVICE_RESPONSES,
} from '../../../../../testing/bff-web/publish-service.fixtures';
import { provideTranslateTesting } from '../../../../../testing/translate-testing';
import { PublishServiceGateway } from '../publish-service.gateway';
import {
  OwnService,
  PublishOutcome,
  toOwnService,
  toPublishedService,
} from '../publish-service.model';
import { ServicePublicationsStore } from '../service-publications.store';
import { ServicePublishDetail } from './service-publish-detail';

// Datos sintéticos de prueba, derivados de los fixtures del contrato bff-web 0.16.0.
const DRAFT: OwnService = toOwnService(MY_SERVICE_RESPONSES.draft.body);
const WITHOUT_AVAILABILITY: OwnService = toOwnService(
  MY_SERVICE_RESPONSES.draftWithoutAvailability.body,
);
const ALREADY_PUBLISHED: OwnService = toOwnService(MY_SERVICE_RESPONSES.published.body);
const PUBLISHED = toPublishedService(PUBLISH_SERVICE_RESPONSES.published.body);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function httpError(status: number, code: string): HttpErrorResponse {
  return new HttpErrorResponse({
    status,
    error: { code, message: 'simulado', correlation_id: 'ref-sintetica-19d', details: [] },
  });
}

function failed(status: number, code: string): PublishOutcome {
  return { kind: 'failed', error: toApiError(httpError(status, code)) };
}

describe('ServicePublishDetail (HU019)', () => {
  let fixture: ComponentFixture<ServicePublishDetail>;
  let element: HTMLElement;
  let loadService: jasmine.Spy;
  let publish: jasmine.Spy;
  let params: BehaviorSubject<ParamMap>;
  let store: ServicePublicationsStore;

  async function create(): Promise<void> {
    fixture = TestBed.createComponent(ServicePublishDetail);
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

  function keysUsed(): string[] {
    return publish.calls.allArgs().map(([, key]) => key as string);
  }

  async function confirmPublication(): Promise<void> {
    button('Publicar')!.click();
    await settle();
    button('Sí, publicar')!.click();
    await settle();
  }

  beforeEach(async () => {
    params = new BehaviorSubject(convertToParamMap({ serviceId: DRAFT.id }));
    loadService = jasmine.createSpy('loadService').and.resolveTo(DRAFT);
    publish = jasmine
      .createSpy('publish')
      .and.resolveTo({ kind: 'published', service: PUBLISHED, replayed: false });
    await TestBed.configureTestingModule({
      imports: [ServicePublishDetail],
      providers: [
        provideRouter([]),
        provideTranslateTesting(),
        { provide: LOCALE_ID, useValue: DEFAULT_LANGUAGE },
        ServicePublicationsStore,
        { provide: PublishServiceGateway, useValue: { loadService, publish } },
        { provide: ActivatedRoute, useValue: { paramMap: params.asObservable() } },
      ],
    }).compileComponents();
    store = TestBed.inject(ServicePublicationsStore);
  });

  it('muestra la carga mientras consulta el servicio', async () => {
    loadService.and.returnValue(new Promise(() => undefined));
    await create();

    expect(byTestId('state-loading')).not.toBeNull();
  });

  it('muestra tarifa COP, unidad de cobro y disponibilidad futura como requisitos separados', async () => {
    await create();

    expect(loadService).toHaveBeenCalledOnceWith(DRAFT.id);
    expect(byTestId('service-detail-name')?.textContent).toContain('Valoración deportiva inicial');
    expect(byTestId('service-detail-status')?.textContent).toContain('Borrador');
    expect(byTestId('requirement-price')?.textContent?.replace(/\s/g, ' ')).toContain(
      '$ 120.000 (COP)',
    );
    expect(byTestId('requirement-billing-unit')?.textContent).toContain('Por sesión');
    const availability = byTestId('requirement-availability')!;
    expect(availability.textContent).toContain('Horarios futuros: 1');
    expect(availability.textContent).toContain('1 de marzo de 2027');
    expect(availability.textContent).toContain('America/Bogota');
    const requirements = byTestId('service-requirements')!;
    expect(requirements.getAttribute('aria-labelledby')).toBe('service-requirements-heading');
    expect(requirements.textContent).toContain('Publicar no confirma pagos');
    expect(requirements.textContent).toContain('planes de afiliación');
    expect(button('Publicar')).toBeDefined();
    expect(byTestId('service-no-upcoming')).toBeNull();
  });

  it('advierte, sin bloquear, cuando no hay horarios futuros', async () => {
    loadService.and.resolveTo(WITHOUT_AVAILABILITY);
    await create();

    expect(byTestId('requirement-availability')?.textContent).toContain('Sin horarios futuros.');
    expect(byTestId('service-no-upcoming')?.textContent).toContain('necesita al menos uno');
    expect(button('Publicar')).toBeDefined();
  });

  it('pide confirmación antes de publicar y permite cancelar', async () => {
    await create();

    button('Publicar')!.click();
    await settle();

    const confirm = byTestId('service-publish-confirm')!;
    expect(confirm.getAttribute('role')).toBe('group');
    expect(confirm.textContent).toContain('¿Publicar «Valoración deportiva inicial»?');
    expect(confirm.textContent).toContain('no reserva cupos ni genera cobros');
    expect(document.activeElement).toBe(confirm.querySelector('h3'));
    expect(publish).not.toHaveBeenCalled();

    button('Cancelar')!.click();
    await settle();

    expect(byTestId('service-publish-confirm')).toBeNull();
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
    const result = byTestId('service-published')!;
    expect(result.getAttribute('role')).toBe('status');
    expect(result.textContent).toContain('Servicio publicado');
    expect(result.textContent).toContain('catálogo de servicios');
    expect(byTestId('service-published-version')?.textContent).toContain('2');
    expect(byTestId('service-published-at')?.textContent?.trim()).not.toBe('');
    expect(byTestId('service-detail-status')?.textContent).toContain('Publicado');
    expect(document.activeElement).toBe(result.querySelector('h3'));
    expect(store.find(DRAFT.id)).toEqual(PUBLISHED);
    expect(button('Publicar')).toBeUndefined();
  });

  it('CA2: un 422 lista los requisitos junto a cada fila y conserva el borrador', async () => {
    publish.and.resolveTo({
      kind: 'invalid',
      violations: [
        { field: 'description', issue: 'invalid_length' },
        { field: 'price.amount', issue: 'out_of_range' },
        { field: 'availability', issue: 'required' },
      ],
    });
    await create();

    await confirmPublication();

    const summary = byTestId('service-publish-violations')!;
    expect(summary.getAttribute('role')).toBe('alert');
    expect(document.activeElement).toBe(summary);
    expect([...summary.querySelectorAll('li')].map((li) => li.textContent?.trim())).toEqual([
      'Descripción: la longitud no es válida.',
      'Tarifa en COP: está fuera del rango permitido.',
      'Disponibilidad futura: necesita al menos un horario futuro.',
    ]);
    expect(summary.textContent).toContain('sigue como borrador');
    expect(byTestId('requirement-availability')?.textContent).toContain(
      'necesita al menos un horario futuro.',
    );
    expect(byTestId('service-detail-status')?.textContent).toContain('Borrador');
    expect(store.find(DRAFT.id)).toBeNull();
    expect(button('Publicar')).toBeDefined();
  });

  it('CA3: un servicio ajeno o inexistente se informa sin datos', async () => {
    loadService.and.rejectWith(httpError(404, 'service_not_found'));
    await create();

    expect(byTestId('service-not-found')?.textContent).toContain('no existe o no es tuyo');
    expect(byTestId('service-detail')).toBeNull();
    expect(button('Publicar')).toBeUndefined();
  });

  it('CA3: si el backend rechaza la publicación por propiedad, no se muestra como publicada', async () => {
    publish.and.resolveTo(failed(404, 'service_not_found'));
    await create();

    await confirmPublication();

    expect(byTestId('service-publish-error')?.textContent).toContain('no existe o no es tuyo');
    expect(byTestId('service-published')).toBeNull();
  });

  it('CA4: un servicio ya publicado no ofrece publicar otra vez', async () => {
    loadService.and.resolveTo(ALREADY_PUBLISHED);
    await create();

    expect(byTestId('service-detail-status')?.textContent).toContain('Publicado');
    expect(byTestId('service-already-published')).not.toBeNull();
    expect(button('Publicar')).toBeUndefined();
  });

  it('CA4: informa que la publicación ya existía cuando el BFF devuelve un reintento', async () => {
    publish.and.resolveTo({ kind: 'published', service: PUBLISHED, replayed: true });
    await create();

    await confirmPublication();

    expect(byTestId('service-publish-replayed')?.textContent).toContain('no se publicó dos veces');
  });

  it('avisa los reintentos automáticos mientras ocurren y evita el doble envío', async () => {
    let finish!: (outcome: PublishOutcome) => void;
    publish.and.callFake((_id: string, _key: string, onRetry: (attempt: number) => void) => {
      onRetry(2);
      return new Promise((resolve) => (finish = resolve));
    });
    await create();
    button('Publicar')!.click();
    await settle();

    const confirm = button('Sí, publicar')!;
    confirm.click();
    confirm.click();
    fixture.detectChanges();

    expect(byTestId('service-publish-retrying')?.textContent).toContain('Reintentando (2 de 3)');
    expect(button('Publicando…')?.disabled).toBeTrue();
    expect(publish).toHaveBeenCalledTimes(1);
    finish({ kind: 'published', service: PUBLISHED, replayed: false });
    await settle();
    expect(byTestId('service-publish-retrying')).toBeNull();
    expect(byTestId('service-published')).not.toBeNull();
  });

  it('CA4: tras agotar los reintentos, volver a publicar usa la misma clave', async () => {
    publish.and.resolveTo(failed(503, 'upstream_unavailable'));
    await create();
    await confirmPublication();

    const error = byTestId('service-publish-error')!;
    expect(error.getAttribute('role')).toBe('alert');
    expect(error.textContent).toContain('no se publicará dos veces');
    expect(error.textContent).toContain('ref-sintetica-19d');

    publish.and.resolveTo({ kind: 'published', service: PUBLISHED, replayed: true });
    button('Sí, publicar')!.click();
    await settle();

    expect(keysUsed()[1]).toBe(keysUsed()[0]);
    expect(byTestId('service-published')).not.toBeNull();
  });

  it('CA4: idempotency_key_reused se explica y el siguiente intento usa otra clave', async () => {
    publish.and.resolveTo(failed(409, 'idempotency_key_reused'));
    await create();
    await confirmPublication();

    expect(byTestId('service-publish-error')?.textContent).toContain(
      'Vuelve a publicar el servicio',
    );
    expect(byTestId('service-publish-error')?.textContent).not.toContain(
      'no se publicará dos veces',
    );
    button('Sí, publicar')!.click();
    await settle();

    expect(keysUsed()[1]).not.toBe(keysUsed()[0]);
  });

  it('un rechazo por permiso no se presenta como publicación', async () => {
    publish.and.resolveTo(failed(403, 'permission_required'));
    await create();
    await confirmPublication();

    expect(byTestId('service-publish-error')?.textContent).toContain(
      'No tienes permiso para realizar esta acción.',
    );
    expect(byTestId('service-published')).toBeNull();
  });

  it('al abrir otro servicio descarta el intento anterior y usa una clave nueva', async () => {
    publish.and.resolveTo(failed(503, 'upstream_unavailable'));
    await create();
    await confirmPublication();

    params.next(convertToParamMap({ serviceId: WITHOUT_AVAILABILITY.id }));
    loadService.and.resolveTo(WITHOUT_AVAILABILITY);
    await settle();
    params.next(convertToParamMap({ serviceId: DRAFT.id }));
    loadService.and.resolveTo(DRAFT);
    await settle();
    await confirmPublication();

    expect(byTestId('service-publish-error')).not.toBeNull();
    expect(keysUsed()[1]).not.toBe(keysUsed()[0]);
  });

  it('un error al consultar el servicio se muestra con referencia y reintento', async () => {
    loadService.and.rejectWith(httpError(504, 'upstream_timeout'));
    await create();

    expect(byTestId('state-error')?.textContent).toContain('ref-sintetica-19d');
    loadService.and.resolveTo(DRAFT);
    button('Reintentar')!.click();
    await settle();

    expect(byTestId('service-detail-name')).not.toBeNull();
  });
});
