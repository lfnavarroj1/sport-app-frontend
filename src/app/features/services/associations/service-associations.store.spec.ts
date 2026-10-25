import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';

import {
  FakeServiceAssociationsGateway,
  testAssociation,
} from '../../../../testing/fake-service-associations.gateway';
import { ApiError } from '../../../core/api/api-error';
import { ServiceAssociationsGateway } from './service-associations.gateway';
import { ServiceAssociationsStore } from './service-associations.store';

const SERVER_ERROR: ApiError = {
  kind: 'server',
  status: 503,
  code: 'upstream_unavailable',
  correlationId: 'ref-sintetica-17',
};

function httpError(status: number, code: string): HttpErrorResponse {
  return new HttpErrorResponse({
    status,
    error: { code, message: 'simulado', correlation_id: 'ref-sintetica-17', details: [] },
  });
}

describe('ServiceAssociationsStore (HU017)', () => {
  let gateway: FakeServiceAssociationsGateway;
  let store: ServiceAssociationsStore;

  beforeEach(() => {
    gateway = new FakeServiceAssociationsGateway();
    TestBed.configureTestingModule({
      providers: [
        ServiceAssociationsStore,
        { provide: ServiceAssociationsGateway, useValue: gateway },
      ],
    });
    store = TestBed.inject(ServiceAssociationsStore);
  });

  it('carga una sola vez las activas y las indexa por servicio', async () => {
    store.ensureLoaded();
    store.ensureLoaded();
    await store.load();

    expect(gateway.loadPage).toHaveBeenCalledWith('ACTIVE', null);
    expect(store.state().status).toBe('success');
    expect(store.activeByService().get(testAssociation(1).serviceId)?.id).toBe(
      testAssociation(1).id,
    );
  });

  it('una lista sin asociaciones es vacía y un fallo nunca se presenta como vacío', async () => {
    gateway.loadPage.and.resolveTo({ associations: [], nextCursor: null });
    await store.load();
    expect(store.state().status).toBe('empty');

    gateway.loadPage.and.rejectWith(httpError(503, 'upstream_unavailable'));
    await store.load();
    expect(store.state()).toEqual({
      status: 'error',
      error: jasmine.objectContaining({ kind: 'server' }),
    });
    expect(store.associations()).toEqual([]);
  });

  it('403 capability_required al consultar lo marca para explicarlo', async () => {
    gateway.loadPage.and.rejectWith(httpError(403, 'capability_required'));
    await store.load();

    expect(store.capabilityMissing()).toBeTrue();
  });

  it('CA5: el historial consulta status=ALL y solo las activas cuentan como asociadas', async () => {
    gateway.loadPage.and.resolveTo({
      associations: [testAssociation(1, 'INACTIVE')],
      nextCursor: null,
    });
    store.setFilter('ALL');
    await Promise.resolve();
    await store.load();

    expect(gateway.loadPage).toHaveBeenCalledWith('ALL', null);
    expect(store.activeByService().size).toBe(0);
  });

  it('«Cargar más» agrega la página siguiente con el cursor y conserva lo cargado si falla', async () => {
    gateway.loadPage.and.resolveTo({ associations: [testAssociation(1)], nextCursor: 'c-1' });
    await store.load();
    gateway.loadPage.and.resolveTo({ associations: [testAssociation(2)], nextCursor: null });
    await store.loadMore();

    expect(gateway.loadPage).toHaveBeenCalledWith('ACTIVE', 'c-1');
    expect(store.associations().map((item) => item.id)).toEqual([
      testAssociation(1).id,
      testAssociation(2).id,
    ]);

    store.nextCursor.set('c-2');
    gateway.loadPage.and.rejectWith(httpError(0, ''));
    await store.loadMore();
    expect(store.associations().length).toBe(2);
    expect(store.moreError()?.kind).toBe('offline');
  });

  it('CA1: asociar agrega al principio lo confirmado y lo resalta', async () => {
    await store.load();
    await store.associate(testAssociation(0).serviceId, 'Servicio', 'catalog');

    expect(gateway.associate).toHaveBeenCalledOnceWith(
      testAssociation(0).serviceId,
      jasmine.any(String),
      jasmine.any(Function),
    );
    expect(store.associations()[0].id).toBe(testAssociation(0).id);
    expect(store.highlighted()).toBe(testAssociation(0).id);
    expect(store.notice()).toEqual({ kind: 'associated', name: 'Servicio' });
    expect(store.message(testAssociation(0).serviceId, 'catalog')?.kind).toBe('associated');
    expect(store.message(testAssociation(0).serviceId, 'list')).toBeNull();
  });

  it('un reintento idempotente no duplica la asociación', async () => {
    await store.load();
    await store.associate(testAssociation(0).serviceId, 'Servicio', 'catalog');
    gateway.associate.and.resolveTo({
      kind: 'associated',
      association: testAssociation(0),
      replayed: true,
    });
    await store.associate(testAssociation(0).serviceId, 'Servicio', 'catalog');

    expect(store.associations().filter((item) => item.id === testAssociation(0).id).length).toBe(1);
  });

  it('sin doble envío: una asociación en curso ignora nuevas acciones', async () => {
    await store.load();
    gateway.associate.and.returnValue(new Promise(() => undefined));
    void store.associate(testAssociation(0).serviceId, 'Servicio', 'catalog');
    void store.associate(testAssociation(0).serviceId, 'Servicio', 'catalog');
    void store.dissociate(testAssociation(1), 'list');

    expect(gateway.associate).toHaveBeenCalledTimes(1);
    expect(gateway.dissociate).not.toHaveBeenCalled();
    expect(store.associating()).toBe(testAssociation(0).serviceId);
  });

  it('tras un fallo transitorio el reintento manual usa la misma clave; tras un éxito, otra', async () => {
    await store.load();
    gateway.associate.and.resolveTo({ kind: 'failed', error: SERVER_ERROR });
    await store.associate(testAssociation(0).serviceId, 'Servicio', 'catalog');
    gateway.associate.and.resolveTo({
      kind: 'associated',
      association: testAssociation(0),
      replayed: true,
    });
    await store.associate(testAssociation(0).serviceId, 'Servicio', 'catalog');
    await store.associate(testAssociation(0).serviceId, 'Servicio', 'catalog');

    const keys = gateway.associate.calls.allArgs().map((args) => args[1]);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[1]);
  });

  it('CA3: una asociación existente no se duplica; se recarga la lista y se resalta la activa', async () => {
    await store.load();
    gateway.associate.and.resolveTo({ kind: 'exists', associationId: testAssociation(1).id });
    gateway.loadPage.calls.reset();
    await store.associate(testAssociation(1).serviceId, 'Servicio', 'list');

    expect(gateway.loadPage).toHaveBeenCalledOnceWith('ACTIVE', null);
    expect(store.highlighted()).toBe(testAssociation(1).id);
    expect(store.notice()?.kind).toBe('exists');
    expect(store.message(testAssociation(1).serviceId, 'list')?.kind).toBe('exists');
  });

  it('CA2: 403 capability_required al asociar marca la falta de capacidad', async () => {
    await store.load();
    gateway.associate.and.resolveTo({
      kind: 'failed',
      error: { kind: 'forbidden', status: 403, code: 'capability_required', correlationId: null },
    });
    await store.associate(testAssociation(0).serviceId, 'Servicio', 'catalog');

    expect(store.capabilityMissing()).toBeTrue();
    expect(store.message(testAssociation(0).serviceId, 'catalog')?.kind).toBe('failed');
  });

  it('CA5: quitar vuelve a consultar la lista para mostrar lo que confirmó el backend', async () => {
    await store.load();
    gateway.loadPage.calls.reset();
    await store.dissociate(testAssociation(1), 'list');

    expect(gateway.dissociate).toHaveBeenCalledOnceWith(testAssociation(1).id);
    expect(gateway.loadPage).toHaveBeenCalledOnceWith('ACTIVE', null);
    expect(store.notice()).toEqual({ kind: 'dissociated', name: testAssociation(1).name });
  });

  it('404 association_not_found al quitar informa el fallo y recarga la lista', async () => {
    await store.load();
    gateway.dissociate.and.resolveTo({
      kind: 'failed',
      error: { kind: 'not_found', status: 404, code: 'association_not_found', correlationId: null },
    });
    gateway.loadPage.calls.reset();
    await store.dissociate(testAssociation(1), 'catalog');

    expect(store.message(testAssociation(1).serviceId, 'catalog')).toEqual(
      jasmine.objectContaining({ kind: 'failed', action: 'dissociate' }),
    );
    expect(gateway.loadPage).toHaveBeenCalledTimes(1);
    expect(store.notice()).toBeNull();
  });
});
