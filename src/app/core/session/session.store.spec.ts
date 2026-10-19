import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, UrlTree } from '@angular/router';

import { requireSession } from './session.guards';
import { RefreshOutcome, SessionRefresher } from './session-refresher';
import { RENEWAL_LEAD_MS, RENEWAL_RETRY_MS, Session, SessionStore } from './session.store';

const USER = {
  id: '0b9f6c1e-3d2a-4f5b-8c7d-1e2f3a4b5c6d',
  fullName: 'Persona Sintética',
  email: 'persona@example.com',
  actorType: 'athlete',
} as const;

function sessionFor(expiresInMs: number): Session {
  return { user: USER, accessToken: 'token-sintetico', expiresAt: Date.now() + expiresInMs };
}

describe('SessionStore sin renovación (HU003)', () => {
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
    function runGuard(): Promise<boolean | UrlTree> {
      return TestBed.runInInjectionContext(
        () => requireSession({} as never, {} as never) as Promise<boolean | UrlTree>,
      );
    }

    it('permite la ruta con una sesión vigente', async () => {
      store.start(sessionFor(60_000));

      expect(await runGuard()).toBeTrue();
    });

    it('redirige al inicio de sesión sin sesión', async () => {
      const result = await runGuard();

      expect(result).toEqual(TestBed.inject(Router).parseUrl('/iniciar-sesion'));
    });
  });
});

type PendingOutcome = RefreshOutcome | (() => RefreshOutcome);

/**
 * Renovador controlado por la prueba: entrega los resultados en orden. Una función
 * se evalúa al renovar, para que el vencimiento dependa de ese instante.
 */
class FakeRefresher extends SessionRefresher {
  readonly outcomes: PendingOutcome[] = [];
  calls = 0;

  refresh(): Promise<RefreshOutcome> {
    this.calls++;
    const next = this.outcomes.shift() ?? { kind: 'rejected' };
    return Promise.resolve(typeof next === 'function' ? next() : next);
  }
}

/** Deja correr las promesas pendientes (el reloj simulado no las adelanta). */
async function flushPromises(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

describe('SessionStore con la cookie del BFF (HU003)', () => {
  const FIFTEEN_MINUTES = 15 * 60_000;
  let store: SessionStore;
  let refresher: FakeRefresher;

  function sessionWith(accessToken: string, user: Session['user'] = USER): Session {
    return { user, accessToken, expiresAt: Date.now() + FIFTEEN_MINUTES };
  }

  function renewed(accessToken: string, user: Session['user'] = USER): () => RefreshOutcome {
    return () => ({ kind: 'renewed', session: sessionWith(accessToken, user) });
  }

  beforeEach(() => {
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date('2026-10-12T12:00:00Z'));
    refresher = new FakeRefresher();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: SessionRefresher, useValue: refresher }],
    });
    store = TestBed.inject(SessionStore);
  });

  afterEach(() => jasmine.clock().uninstall());

  describe('recuperación al recargar la pestaña', () => {
    it('recupera la sesión con la cookie vigente', async () => {
      refresher.outcomes.push(renewed('token-recuperado'));

      await store.restore();

      expect(store.user()).toEqual(USER);
      expect(store.accessToken()).toBe('token-recuperado');
    });

    it('sin cookie válida no hay sesión ni aviso de vencimiento', async () => {
      refresher.outcomes.push({ kind: 'rejected' });

      await store.restore();

      expect(store.isAuthenticated()).toBeFalse();
      expect(store.lastEndReason()).toBeNull();
    });

    it('se intenta una sola vez por carga de la página', async () => {
      await Promise.all([store.restore(), store.restore()]);
      await store.restore();

      expect(refresher.calls).toBe(1);
    });

    it('no consulta el BFF si la pestaña ya tiene sesión', async () => {
      store.start(sessionWith('token-del-formulario'));

      await store.restore();

      expect(refresher.calls).toBe(0);
    });

    it('una sesión iniciada con el formulario mientras tanto prevalece', async () => {
      let resolve!: (outcome: RefreshOutcome) => void;
      spyOn(refresher, 'refresh').and.returnValue(new Promise((r) => (resolve = r)));
      const restoration = store.restore();

      store.start({
        user: USER,
        accessToken: 'token-del-formulario',
        expiresAt: Date.now() + 60_000,
      });
      resolve(renewed('token-recuperado')());
      await restoration;

      expect(store.accessToken()).toBe('token-del-formulario');
    });
  });

  describe('renovación antes del vencimiento', () => {
    beforeEach(() => store.start(sessionWith('token-inicial')));

    it(`renueva ${RENEWAL_LEAD_MS / 1000} s antes de vencer y la sesión continúa`, async () => {
      refresher.outcomes.push(renewed('token-renovado'));

      jasmine.clock().tick(FIFTEEN_MINUTES - RENEWAL_LEAD_MS - 1);
      expect(refresher.calls).toBe(0);

      jasmine.clock().tick(1);
      await flushPromises();

      expect(refresher.calls).toBe(1);
      expect(store.accessToken()).toBe('token-renovado');

      // El vencimiento anterior ya no aplica: la sesión sigue después de él.
      jasmine.clock().tick(RENEWAL_LEAD_MS);
      expect(store.isAuthenticated()).toBeTrue();
    });

    it('renueva una y otra vez mientras la cookie siga vigente', async () => {
      refresher.outcomes.push(renewed('token-2'), renewed('token-3'));

      for (let i = 0; i < 2; i++) {
        jasmine.clock().tick(FIFTEEN_MINUTES - RENEWAL_LEAD_MS);
        await flushPromises();
      }

      expect(refresher.calls).toBe(2);
      expect(store.accessToken()).toBe('token-3');
    });

    it('si el BFF rechaza la cookie, la sesión termina e informa el vencimiento', async () => {
      refresher.outcomes.push({ kind: 'rejected' });

      jasmine.clock().tick(FIFTEEN_MINUTES - RENEWAL_LEAD_MS);
      await flushPromises();

      expect(store.isAuthenticated()).toBeFalse();
      expect(store.lastEndReason()).toBe('expired');
    });

    it('si el BFF no está disponible reintenta y conserva la sesión', async () => {
      refresher.outcomes.push({ kind: 'unavailable' }, renewed('token-tras-reintento'));

      jasmine.clock().tick(FIFTEEN_MINUTES - RENEWAL_LEAD_MS);
      await flushPromises();
      expect(store.accessToken()).toBe('token-inicial');

      jasmine.clock().tick(RENEWAL_RETRY_MS);
      await flushPromises();

      expect(refresher.calls).toBe(2);
      expect(store.accessToken()).toBe('token-tras-reintento');
    });

    it('si el BFF sigue sin responder, la sesión termina al vencer el access token', async () => {
      refresher.outcomes.push(
        { kind: 'unavailable' },
        { kind: 'unavailable' },
        { kind: 'unavailable' },
        { kind: 'unavailable' },
      );

      for (let elapsed = 0; elapsed < FIFTEEN_MINUTES; elapsed += 5_000) {
        jasmine.clock().tick(5_000);
        await flushPromises();
      }

      expect(store.isAuthenticated()).toBeFalse();
      expect(store.lastEndReason()).toBe('expired');
    });

    it('no adopta la identidad de otra cuenta que inició sesión en otra pestaña', async () => {
      refresher.outcomes.push(renewed('token-ajeno', { ...USER, id: 'otra-cuenta' }));

      jasmine.clock().tick(FIFTEEN_MINUTES - RENEWAL_LEAD_MS);
      await flushPromises();

      expect(store.isAuthenticated()).toBeFalse();
      expect(store.accessToken()).toBeNull();
    });

    it('si la sesión termina mientras se renueva, no se reabre', async () => {
      let resolve!: (outcome: RefreshOutcome) => void;
      spyOn(refresher, 'refresh').and.returnValue(new Promise((r) => (resolve = r)));

      jasmine.clock().tick(FIFTEEN_MINUTES - RENEWAL_LEAD_MS);
      store.end();
      resolve(renewed('token-renovado')());
      await flushPromises();

      expect(store.isAuthenticated()).toBeFalse();
    });

    it('cerrar la sesión cancela la renovación pendiente', () => {
      store.end();

      jasmine.clock().tick(FIFTEEN_MINUTES);

      expect(refresher.calls).toBe(0);
    });
  });
});
