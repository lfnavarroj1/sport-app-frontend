import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';

import { SessionAccess, SessionAccessStore } from '../../../core/session/session-access.store';
import { ViewState, viewState } from '../../../shared/ui/view-state';
import { requirePermission } from './require-permission.guard';

function access(permissions: string[]): ViewState<SessionAccess> {
  return {
    status: 'success',
    data: {
      actorType: 'organizer',
      subscriptionStatus: 'NOT_APPLICABLE',
      permissions: new Set(permissions),
      capabilities: new Set(),
    } as SessionAccess,
  };
}

describe('requirePermission (HU024: «Publicar eventos» exige events.publish)', () => {
  let view: ReturnType<typeof signal<ViewState<SessionAccess> | null>>;
  let ensureLoaded: jasmine.Spy;
  let router: Router;

  beforeEach(() => {
    view = signal<ViewState<SessionAccess> | null>(null);
    ensureLoaded = jasmine.createSpy('ensureLoaded');
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: SessionAccessStore, useValue: { view: view.asReadonly(), ensureLoaded } },
      ],
    });
    router = TestBed.inject(Router);
  });

  function run(): Promise<boolean | UrlTree> {
    return TestBed.runInInjectionContext(
      () =>
        requirePermission('events.publish')({} as never, {} as never) as Promise<boolean | UrlTree>,
    );
  }

  it('permite la ruta cuando el BFF confirma el permiso', async () => {
    view.set(access(['events.create', 'events.publish']));

    expect(await run()).toBeTrue();
    expect(ensureLoaded).toHaveBeenCalled();
  });

  it('sin el permiso confirmado lleva al acceso no autorizado', async () => {
    view.set(access(['events.create']));

    expect(await run()).toEqual(router.parseUrl('/acceso-no-autorizado'));
  });

  it('espera a que termine la consulta de capacidades antes de decidir', async () => {
    view.set(viewState.loading());
    const decision = run();
    await Promise.resolve();
    TestBed.tick();
    view.set(access([]));
    TestBed.tick();

    expect(await decision).toEqual(router.parseUrl('/acceso-no-autorizado'));
  });

  it('si la vista no se pudo confirmar, deja decidir al backend (no asume el permiso)', async () => {
    view.set(viewState.fromError(new HttpErrorResponse({ status: 503 })));

    expect(await run()).toBeTrue();
  });
});
