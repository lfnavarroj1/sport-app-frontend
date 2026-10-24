import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';

import { SessionAccess, SessionAccessStore } from '../../core/session/session-access.store';
import { ViewState, viewState } from '../../shared/ui/view-state';
import { requireCapability } from './require-capability.guard';

const PREMIUM_ONLY = 'services.sports_medicine.access';

function access(
  capabilities: string[],
  subscriptionStatus: SessionAccess['subscriptionStatus'] = 'ACTIVE',
): ViewState<SessionAccess> {
  return {
    status: 'success',
    data: {
      actorType: 'athlete',
      subscriptionStatus,
      permissions: new Set(),
      capabilities: new Set(capabilities),
    },
  };
}

describe('requireCapability (HU016: guardas ante URL directa)', () => {
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
      () => requireCapability(PREMIUM_ONLY)({} as never, {} as never) as Promise<boolean | UrlTree>,
    );
  }

  it('permite la ruta cuando el plan vigente incluye la capacidad', async () => {
    view.set(access(['training.plan.manage', PREMIUM_ONLY]));

    expect(await run()).toBeTrue();
    expect(ensureLoaded).toHaveBeenCalled();
  });

  it('tras bajar de plan, la URL directa lleva al acceso no autorizado', async () => {
    view.set(access(['training.plan.manage']));

    expect(await run()).toEqual(router.parseUrl('/acceso-no-autorizado'));
  });

  it('en PROVISIONING no concede capacidades', async () => {
    view.set(access([PREMIUM_ONLY], 'PROVISIONING'));

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

  it('si la vista no se pudo confirmar, deja decidir al backend (no asume la capacidad)', async () => {
    view.set(viewState.fromError(new HttpErrorResponse({ status: 503 })));

    expect(await run()).toBeTrue();
  });
});
