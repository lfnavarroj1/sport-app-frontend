import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';

import {
  DRAFT_WITHOUT_FEE,
  PUBLISHED_WITH_REGISTRATIONS,
  PUT_EVENT_FEE_RESPONSES,
} from '../../../../testing/bff-web/event-pricing.fixtures';
import { EventPricingGateway } from './event-pricing.gateway';
import { toPricedEvent } from './event-pricing.model';
import { EventPricingStore } from './event-pricing.store';

const DRAFT = toPricedEvent(DRAFT_WITHOUT_FEE);
const PUBLISHED = toPricedEvent(PUBLISHED_WITH_REGISTRATIONS);

describe('EventPricingStore (HU025)', () => {
  let loadOwnEvents: jasmine.Spy;
  let store: EventPricingStore;

  beforeEach(() => {
    loadOwnEvents = jasmine.createSpy('loadOwnEvents').and.resolveTo([DRAFT, PUBLISHED]);
    TestBed.configureTestingModule({
      providers: [EventPricingStore, { provide: EventPricingGateway, useValue: { loadOwnEvents } }],
    });
    store = TestBed.inject(EventPricingStore);
  });

  it('carga los eventos propios y los busca por identificador', async () => {
    expect(store.find(DRAFT.id)).toBeNull();
    await store.load();

    expect(store.view().status).toBe('success');
    expect(store.find(PUBLISHED.id)).toEqual(PUBLISHED);
    expect(store.find('otro')).toBeNull();
  });

  it('sin eventos queda vacío y un fallo queda como error', async () => {
    loadOwnEvents.and.resolveTo([]);
    await store.load();
    expect(store.view().status).toBe('empty');

    loadOwnEvents.and.rejectWith(new HttpErrorResponse({ status: 503 }));
    await store.load();
    expect(store.view()).toEqual({
      status: 'error',
      error: jasmine.objectContaining({ status: 503 }),
    });
  });

  it('reemplaza el evento con el confirmado por el comando, sin tocar los demás', async () => {
    await store.load();
    const changed = toPricedEvent(PUT_EVENT_FEE_RESPONSES.assigned.body);
    store.replace(changed);

    expect(store.find(PUBLISHED.id)).toEqual(changed);
    expect(store.find(DRAFT.id)).toEqual(DRAFT);
  });
});
