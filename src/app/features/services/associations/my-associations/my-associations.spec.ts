import { HttpErrorResponse } from '@angular/common/http';
import { LOCALE_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import {
  FakeServiceAssociationsGateway,
  testAssociation,
} from '../../../../../testing/fake-service-associations.gateway';
import { provideTranslateTesting } from '../../../../../testing/translate-testing';
import { formatPrice } from '../../availability/availability-format';
import { formatInstant } from '../association-format';
import { ServiceAssociationsGateway } from '../service-associations.gateway';
import { ServiceAssociationsStore } from '../service-associations.store';
import { MyAssociations } from './my-associations';

const LOCALE = 'es';

function httpError(status: number, code: string): HttpErrorResponse {
  return new HttpErrorResponse({
    status,
    error: { code, message: 'simulado', correlation_id: 'ref-sintetica-17', details: [] },
  });
}

describe('MyAssociations (HU017)', () => {
  let fixture: ComponentFixture<MyAssociations>;
  let element: HTMLElement;
  let gateway: FakeServiceAssociationsGateway;
  let store: ServiceAssociationsStore;

  async function create(): Promise<void> {
    fixture = TestBed.createComponent(MyAssociations);
    store = TestBed.inject(ServiceAssociationsStore);
    await settle();
    element = fixture.nativeElement as HTMLElement;
  }

  async function settle(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function byTestId(testId: string): HTMLElement | null {
    return element.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  }

  function items(): HTMLElement[] {
    return [...element.querySelectorAll<HTMLElement>('[data-testid="associations-list"] > li')];
  }

  beforeEach(async () => {
    gateway = new FakeServiceAssociationsGateway();
    await TestBed.configureTestingModule({
      imports: [MyAssociations],
      providers: [
        provideTranslateTesting(),
        provideRouter([]),
        { provide: LOCALE_ID, useValue: LOCALE },
        ServiceAssociationsStore,
        { provide: ServiceAssociationsGateway, useValue: gateway },
      ],
    }).compileComponents();
  });

  it('muestra la carga mientras consulta', async () => {
    gateway.loadPage.and.returnValue(new Promise(() => undefined));
    await create();

    expect(byTestId('state-loading')).not.toBeNull();
  });

  it('CA4: explica que asociar no comparte datos de salud, no contrata, no reserva ni paga', async () => {
    await create();

    expect(element.querySelector('h2')?.textContent).toContain('Mis servicios asociados');
    expect(byTestId('associations-privacy')?.textContent).toContain(
      'no comparte tus datos de salud con el profesional, no contrata, no reserva ni paga',
    );
  });

  it('lista las asociaciones activas con el resumen del servicio y la fecha en la zona local', async () => {
    const association = testAssociation(1);
    await create();

    expect(gateway.loadPage).toHaveBeenCalledOnceWith('ACTIVE', null);
    const [item] = items();
    expect(item.getAttribute('data-service')).toBe(association.serviceId);
    expect(item.querySelector('h3')?.textContent).toContain(association.name);
    expect(item.textContent).toContain('Medicina deportiva');
    expect(item.textContent).toContain(formatPrice(association.fee.amount));
    expect(item.textContent).toContain('Asociado');
    expect(item.querySelector('[data-testid="association-associated-at"]')?.textContent).toContain(
      formatInstant(association.associatedAt, LOCALE),
    );
    expect(item.querySelector('[data-testid="association-ended-at"]')).toBeNull();
  });

  it('sin asociaciones muestra el estado vacío', async () => {
    gateway.loadPage.and.resolveTo({ associations: [], nextCursor: null });
    await create();

    expect(byTestId('state-empty')?.textContent).toContain(
      'Aún no tienes servicios médicos deportivos asociados.',
    );
  });

  it('un error se muestra con referencia y reintento, nunca como lista vacía', async () => {
    gateway.loadPage.and.rejectWith(httpError(503, 'upstream_unavailable'));
    await create();

    expect(byTestId('state-empty')).toBeNull();
    expect(byTestId('state-error')?.textContent).toContain('ref-sintetica-17');
    gateway.loadPage.and.resolveTo({ associations: [testAssociation(1)], nextCursor: null });
    byTestId('state-error')!.querySelector('button')!.click();
    await settle();

    expect(items().length).toBe(1);
  });

  it('CA2: sin la capacidad explica el plan y enlaza a «Comparar planes», sin datos', async () => {
    gateway.loadPage.and.rejectWith(httpError(403, 'capability_required'));
    await create();

    const notice = byTestId('associations-capability')!;
    expect(notice.getAttribute('role')).toBe('alert');
    expect(notice.textContent).toContain('no incluye los servicios médicos y deportivos');
    expect(notice.querySelector('a')?.getAttribute('href')).toBe('/deportista/plan');
    expect(notice.querySelector('a')?.textContent).toContain('Comparar planes');
    expect(byTestId('associations-list')).toBeNull();
  });

  it('CA5: con el historial consulta status=ALL y muestra la quitada con su fecha', async () => {
    const inactive = testAssociation(2, 'INACTIVE');
    await create();
    gateway.loadPage.and.resolveTo({ associations: [inactive], nextCursor: null });
    byTestId('associations-history')!.querySelector('input')!.click();
    await settle();

    expect(gateway.loadPage).toHaveBeenCalledWith('ALL', null);
    const [item] = items();
    expect(item.textContent).toContain('Quitado');
    expect(item.querySelector('[data-testid="association-ended-at"]')?.textContent).toContain(
      formatInstant(inactive.endedAt!, LOCALE),
    );
    expect(item.querySelector(`[data-testid="association-dissociate-${inactive.id}"]`)).toBeNull();
  });

  it('CA5: quitar pide confirmar, llama una vez y vuelve a consultar la lista', async () => {
    const association = testAssociation(1);
    await create();
    byTestId(`association-dissociate-${association.id}`)!.click();
    await settle();
    const confirm = byTestId(`association-confirm-${association.id}`)!;
    expect(confirm.textContent).toContain(`¿Quitar «${association.name}»`);
    expect(gateway.dissociate).not.toHaveBeenCalled();

    gateway.loadPage.and.resolveTo({ associations: [], nextCursor: null });
    confirm.querySelector('button')!.click();
    await settle();

    expect(gateway.dissociate).toHaveBeenCalledOnceWith(association.id);
    expect(byTestId('associations-notice')?.textContent).toContain(
      `Quitaste «${association.name}». La asociación queda en tu historial.`,
    );
    expect(byTestId('state-empty')).not.toBeNull();
  });

  it('un fallo al quitar se muestra junto a la asociación', async () => {
    const association = testAssociation(1);
    gateway.dissociate.and.resolveTo({
      kind: 'failed',
      error: { kind: 'server', status: 503, code: 'upstream_unavailable', correlationId: 'ref-9' },
    });
    await create();
    byTestId(`association-dissociate-${association.id}`)!.click();
    await settle();
    byTestId(`association-confirm-${association.id}`)!.querySelector('button')!.click();
    await settle();

    const error = byTestId(`association-error-${association.id}`)!;
    expect(error.getAttribute('role')).toBe('alert');
    expect(error.textContent).toContain('ref-9');
    expect(error.querySelector('button')?.textContent?.trim()).toBe('Reintentar');
  });

  it('CA3: resalta la asociación existente que informó el backend', async () => {
    const association = testAssociation(1);
    await create();
    store.highlighted.set(association.id);
    fixture.detectChanges();

    expect(items()[0].classList).toContain('associations__item--highlighted');
  });

  it('«Cargar más» pide la página siguiente con el cursor', async () => {
    gateway.loadPage.and.resolveTo({ associations: [testAssociation(1)], nextCursor: 'c-1' });
    await create();
    gateway.loadPage.and.resolveTo({ associations: [testAssociation(2)], nextCursor: null });
    byTestId('associations-load-more')!.click();
    await settle();

    expect(gateway.loadPage).toHaveBeenCalledWith('ACTIVE', 'c-1');
    expect(items().length).toBe(2);
    expect(byTestId('associations-load-more')).toBeNull();
  });
});
