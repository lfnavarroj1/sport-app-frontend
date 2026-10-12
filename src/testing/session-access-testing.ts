import { Provider, WritableSignal, signal } from '@angular/core';

import { SessionAccess, SessionAccessStore } from '../app/core/session/session-access.store';
import { ActorType } from '../app/core/session/session.store';
import { ViewState } from '../app/shared/ui/view-state';

/** `SessionAccessStore` controlado por la prueba: el estado se fija a mano. */
export interface FakeSessionAccess {
  readonly view: WritableSignal<ViewState<SessionAccess> | null>;
  readonly ensureLoaded: jasmine.Spy;
  readonly reload: jasmine.Spy;
}

export function provideFakeSessionAccess(initial: ViewState<SessionAccess> | null = null): {
  fake: FakeSessionAccess;
  provider: Provider;
} {
  const fake: FakeSessionAccess = {
    view: signal(initial),
    ensureLoaded: jasmine.createSpy('ensureLoaded'),
    reload: jasmine.createSpy('reload'),
  };
  return { fake, provider: { provide: SessionAccessStore, useValue: fake } };
}

/** Vista confirmada por el BFF con los permisos y capacidades indicados. */
export function accessReady(
  actorType: ActorType,
  subscriptionStatus: SessionAccess['subscriptionStatus'],
  permissions: readonly string[] = [],
  capabilities: readonly string[] = [],
): ViewState<SessionAccess> {
  return {
    status: 'success',
    data: {
      actorType,
      subscriptionStatus,
      permissions: new Set(permissions),
      capabilities: new Set(capabilities),
    },
  };
}
