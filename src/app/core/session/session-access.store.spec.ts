import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import {
  FREE_CAPABILITIES,
  GET_CAPABILITIES_RESPONSES,
  ORGANIZER_WEB_PERMISSIONS,
  SIMULATED_CAPABILITIES_CORRELATION_ID,
} from '../../../testing/bff-web/capabilities.fixtures';
import { SimulatedResponse } from '../../../testing/bff-web/register-user.fixtures';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import {
  PROVISIONING_MAX_RECHECKS,
  PROVISIONING_RECHECK_MS,
  SessionAccessStore,
} from './session-access.store';
import { ActorType, SessionStore } from './session.store';

const BFF = 'http://bff.example.com';
const URL = `${BFF}/v1/me/capabilities`;

describe('SessionAccessStore (HU003 CA7–CA10, ADR-024)', () => {
  let http: HttpTestingController;
  let session: SessionStore;
  let access: SessionAccessStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: APP_CONFIG,
          useValue: {
            environment: 'local',
            bffWebBaseUrl: BFF,
            registrationPoliciesVersion: 'local-dev',
            healthDataConsentVersion: null,
          } satisfies AppConfig,
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    session = TestBed.inject(SessionStore);
    access = TestBed.inject(SessionAccessStore);
  });

  afterEach(() => {
    session.end();
    http.verify();
  });

  function signIn(actorType: ActorType, id = '0b9f6c1e-3d2a-4f5b-8c7d-1e2f3a4b5c6d'): void {
    session.start({
      user: { id, fullName: 'Persona Sintética', email: 'persona@example.com', actorType },
      accessToken: `token-${id}`,
      expiresAt: Date.now() + 15 * 60_000,
    });
    TestBed.tick();
  }

  async function respond(response: SimulatedResponse): Promise<void> {
    http.expectOne(URL).flush(response.body as object, {
      status: response.status,
      statusText: 'simulado',
    });
    await Promise.resolve();
    await Promise.resolve();
  }

  it('sin sesión no consulta ni concede nada', () => {
    access.ensureLoaded();

    expect(access.view()).toBeNull();
    http.expectNone(URL);
  });

  it('consulta GET /v1/me/capabilities con el access token como Bearer', async () => {
    signIn('athlete');
    access.ensureLoaded();

    expect(access.view()).toEqual({ status: 'loading' });
    const request = http.expectOne(URL);
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.get('Authorization')).toBe(
      'Bearer token-0b9f6c1e-3d2a-4f5b-8c7d-1e2f3a4b5c6d',
    );
    request.flush(GET_CAPABILITIES_RESPONSES.athleteFree.body);
  });

  it('CA7: el deportista recibe las capacidades vigentes de su plan', async () => {
    signIn('athlete');
    access.ensureLoaded();
    await respond(GET_CAPABILITIES_RESPONSES.athleteFree);

    const view = access.view();
    expect(view?.status).toBe('success');
    if (view?.status === 'success') {
      expect(view.data.subscriptionStatus).toBe('ACTIVE');
      expect([...view.data.capabilities]).toEqual([...FREE_CAPABILITIES]);
      expect(view.data.permissions.size).toBe(0);
    }
  });

  it('CA8: el organizador recibe sus permisos web, sin capacidades de plan', async () => {
    signIn('organizer');
    access.ensureLoaded();
    await respond(GET_CAPABILITIES_RESPONSES.organizer);

    const view = access.view();
    expect(view?.status === 'success' && [...view.data.permissions]).toEqual([
      ...ORGANIZER_WEB_PERMISSIONS,
    ]);
    expect(view?.status === 'success' && view.data.subscriptionStatus).toBe('NOT_APPLICABLE');
  });

  it('se consulta una sola vez por usuario', async () => {
    signIn('organizer');
    access.ensureLoaded();
    access.ensureLoaded();
    await respond(GET_CAPABILITIES_RESPONSES.organizer);
    access.ensureLoaded();

    http.expectNone(URL);
  });

  it('PROVISIONING: no concede capacidades y vuelve a consultar hasta la activación', async () => {
    jasmine.clock().install();
    try {
      signIn('athlete');
      access.ensureLoaded();
      await respond(GET_CAPABILITIES_RESPONSES.athleteProvisioning);

      const view = access.view();
      expect(view?.status === 'success' && view.data.capabilities.size).toBe(0);

      jasmine.clock().tick(PROVISIONING_RECHECK_MS);
      await respond(GET_CAPABILITIES_RESPONSES.athleteFree);

      const active = access.view();
      expect(active?.status === 'success' && active.data.subscriptionStatus).toBe('ACTIVE');
      jasmine.clock().tick(PROVISIONING_RECHECK_MS);
      http.expectNone(URL);
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it(`PROVISIONING: deja de consultar sola tras ${PROVISIONING_MAX_RECHECKS} intentos; el reintento manual sigue disponible`, async () => {
    jasmine.clock().install();
    try {
      signIn('athlete');
      access.ensureLoaded();
      await respond(GET_CAPABILITIES_RESPONSES.athleteProvisioning);
      for (let i = 0; i < PROVISIONING_MAX_RECHECKS; i++) {
        jasmine.clock().tick(PROVISIONING_RECHECK_MS);
        await respond(GET_CAPABILITIES_RESPONSES.athleteProvisioning);
      }

      jasmine.clock().tick(PROVISIONING_RECHECK_MS * 2);
      http.expectNone(URL);

      access.reload();
      await respond(GET_CAPABILITIES_RESPONSES.athleteFree);
      expect(access.view()?.status).toBe('success');
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('503 upstream_unavailable → error trazable con reintento, nunca plan gratuito', async () => {
    signIn('athlete');
    access.ensureLoaded();
    await respond(GET_CAPABILITIES_RESPONSES.upstreamUnavailable);

    expect(access.view()).toEqual({
      status: 'error',
      error: {
        kind: 'server',
        status: 503,
        code: 'upstream_unavailable',
        correlationId: SIMULATED_CAPABILITIES_CORRELATION_ID,
      },
    });

    access.reload();
    expect(access.view()).toEqual({ status: 'loading' });
    await respond(GET_CAPABILITIES_RESPONSES.athleteFree);
    expect(access.view()?.status).toBe('success');
  });

  it('sin conexión → error de tipo offline', async () => {
    signIn('organizer');
    access.ensureLoaded();
    http.expectOne(URL).error(new ProgressEvent('error'), { status: 0 });
    await Promise.resolve();

    expect(access.view()).toEqual(
      jasmine.objectContaining({
        status: 'error',
        error: jasmine.objectContaining({ kind: 'offline' }),
      }),
    );
  });

  it('401 invalid_access_token → la sesión termina como vencida', async () => {
    signIn('organizer');
    access.ensureLoaded();
    await respond(GET_CAPABILITIES_RESPONSES.invalidAccessToken);

    expect(session.isAuthenticated()).toBeFalse();
    expect(session.lastEndReason()).toBe('expired');
  });

  it('CA10: 403 unsupported_actor_type → la sesión termina sin asumir un rol', async () => {
    signIn('athlete');
    access.ensureLoaded();
    await respond(GET_CAPABILITIES_RESPONSES.unsupportedActorType);

    expect(session.isAuthenticated()).toBeFalse();
    expect(session.lastEndReason()).toBe('unauthorized_actor');
  });

  it('CA10: una vista de otro actor que el de la sesión no concede nada', async () => {
    signIn('athlete');
    access.ensureLoaded();
    await respond(GET_CAPABILITIES_RESPONSES.organizer);

    expect(session.isAuthenticated()).toBeFalse();
    expect(session.lastEndReason()).toBe('unauthorized_actor');
  });

  it('al terminar la sesión descarta la vista y una respuesta tardía no la reabre', async () => {
    signIn('athlete');
    access.ensureLoaded();
    const pending = http.expectOne(URL);

    session.end();
    TestBed.tick();
    pending.flush(GET_CAPABILITIES_RESPONSES.athletePremium.body);
    await Promise.resolve();

    expect(access.view()).toBeNull();
  });

  it('otra cuenta en la misma pestaña consulta su propia vista', async () => {
    signIn('organizer');
    access.ensureLoaded();
    await respond(GET_CAPABILITIES_RESPONSES.organizer);

    signIn('service_provider', '5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a');
    expect(access.view()).toBeNull();
    access.ensureLoaded();
    await respond(GET_CAPABILITIES_RESPONSES.serviceProvider);

    const view = access.view();
    expect(view?.status === 'success' && view.data.actorType).toBe('service_provider');
  });
});
