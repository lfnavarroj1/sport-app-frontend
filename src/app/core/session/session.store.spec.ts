import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, UrlTree } from '@angular/router';

import { requireSession } from './session.guards';
import { Session, SessionStore } from './session.store';

const USER = {
  id: '0b9f6c1e-3d2a-4f5b-8c7d-1e2f3a4b5c6d',
  fullName: 'Persona Sintética',
  email: 'persona@example.com',
  actorType: 'athlete',
} as const;

function sessionFor(expiresInMs: number): Session {
  return { user: USER, accessToken: 'token-sintetico', expiresAt: Date.now() + expiresInMs };
}

describe('SessionStore (HU003)', () => {
  let store: SessionStore;

  beforeEach(() => {
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date('2026-10-10T12:00:00Z'));
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    store = TestBed.inject(SessionStore);
  });

  afterEach(() => jasmine.clock().uninstall());

  it('empieza sin sesión', () => {
    expect(store.isAuthenticated()).toBeFalse();
    expect(store.user()).toBeNull();
    expect(store.accessToken()).toBeNull();
  });

  it('CA1: conserva la identidad y el access token mientras están vigentes', () => {
    store.start(sessionFor(15 * 60_000));

    expect(store.isAuthenticated()).toBeTrue();
    expect(store.user()).toEqual(USER);
    expect(store.accessToken()).toBe('token-sintetico');
  });

  it('termina la sesión al vencer el access token e informa el motivo', () => {
    store.start(sessionFor(15 * 60_000));

    jasmine.clock().tick(15 * 60_000);

    expect(store.isAuthenticated()).toBeFalse();
    expect(store.accessToken()).toBeNull();
    expect(store.lastEndReason()).toBe('expired');

    store.acknowledgeEnd();
    expect(store.lastEndReason()).toBeNull();
  });

  it('no entrega un access token vencido aunque el temporizador no haya corrido', () => {
    store.start(sessionFor(1_000));
    jasmine.clock().mockDate(new Date(Date.now() + 2_000));

    expect(store.accessToken()).toBeNull();
  });

  it('una sesión nueva reemplaza el vencimiento de la anterior', () => {
    store.start(sessionFor(1_000));
    store.start(sessionFor(60_000));

    jasmine.clock().tick(1_000);

    expect(store.isAuthenticated()).toBeTrue();
  });

  it('nunca escribe la sesión en el almacenamiento del navegador', () => {
    spyOn(Storage.prototype, 'setItem');

    store.start(sessionFor(60_000));

    expect(Storage.prototype.setItem).not.toHaveBeenCalled();
  });

  describe('requireSession', () => {
    function runGuard(): boolean | UrlTree {
      return TestBed.runInInjectionContext(
        () => requireSession({} as never, {} as never) as boolean | UrlTree,
      );
    }

    it('permite la ruta con una sesión vigente', () => {
      store.start(sessionFor(60_000));

      expect(runGuard()).toBeTrue();
    });

    it('redirige al inicio de sesión sin sesión', () => {
      const result = runGuard();

      expect(result).toEqual(TestBed.inject(Router).parseUrl('/iniciar-sesion'));
    });
  });
});
