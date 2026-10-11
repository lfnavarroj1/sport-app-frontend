import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';

import { ActorType, SessionStore } from '../../core/session/session.store';
import { requireActor } from './actor.guards';

describe('requireActor (ADR-025, HU003 CA10)', () => {
  let session: SessionStore;
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    session = TestBed.inject(SessionStore);
    router = TestBed.inject(Router);
  });

  afterEach(() => session.end());

  function signIn(actorType: ActorType): void {
    session.start({
      user: {
        id: '0b9f6c1e-3d2a-4f5b-8c7d-1e2f3a4b5c6d',
        fullName: 'Persona Sintética',
        email: 'persona@example.com',
        actorType,
      },
      accessToken: 'token-sintetico',
      expiresAt: Date.now() + 60_000,
    });
  }

  function run(actor: ActorType): boolean | UrlTree {
    return TestBed.runInInjectionContext(
      () => requireActor(actor)({} as never, {} as never) as boolean | UrlTree,
    );
  }

  it('sin sesión lleva al inicio de sesión', () => {
    expect(run('organizer')).toEqual(router.parseUrl('/iniciar-sesion'));
  });

  it('permite el área del propio actor', () => {
    signIn('organizer');

    expect(run('organizer')).toBeTrue();
  });

  it('bloquea la URL de otro actor y lleva al acceso no autorizado', () => {
    signIn('athlete');

    expect(run('organizer')).toEqual(router.parseUrl('/acceso-no-autorizado'));
    expect(run('service_provider')).toEqual(router.parseUrl('/acceso-no-autorizado'));
  });
});
