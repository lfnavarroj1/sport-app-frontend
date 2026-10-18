import { TestBed } from '@angular/core/testing';

import { organizerEvent, publishedEvent } from '../../../../testing/bff-web/publish-event.fixtures';
import { toOrganizerEvent } from './publish-event.model';
import { PublishedEventsStore } from './published-events.store';

describe('PublishedEventsStore (HU024)', () => {
  let store: PublishedEventsStore;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [PublishedEventsStore] });
    store = TestBed.inject(PublishedEventsStore);
  });

  it('conserva lo confirmado por el comando, el más reciente primero y sin repetir', () => {
    const first = toOrganizerEvent(publishedEvent(organizerEvent(0)));
    const second = toOrganizerEvent(publishedEvent(organizerEvent(1)));

    store.markPublished(first);
    store.markPublished(second);
    store.markPublished(first);

    expect(store.recent().map((event) => event.id)).toEqual([first.id, second.id]);
    expect(store.recentIds()).toEqual(new Set([first.id, second.id]));
    expect(store.find(second.id)).toEqual(second);
    expect(store.find('7c0f3e1a-0000-4000-8000-000000000000')).toBeNull();
  });
});
