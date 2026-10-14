import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import {
  REFRESH_SESSION_RESPONSES,
  SIMULATED_RENEWED_ACCESS_TOKEN,
} from '../../../testing/bff-web/refresh-session.fixtures';
import { SimulatedResponse } from '../../../testing/bff-web/register-user.fixtures';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { HttpSessionRefresher } from './http-session-refresher';
import { RefreshOutcome } from './session-refresher';

const BFF = 'http://bff.example.com';
const REFRESH_URL = `${BFF}/v1/sessions/refresh`;
const NOW = new Date('2026-10-12T12:00:00Z').getTime();

describe('HttpSessionRefresher (HU003, contrato bff-web 0.12.0)', () => {
  let http: HttpTestingController;
  let refresher: HttpSessionRefresher;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        HttpSessionRefresher,
        {
          provide: APP_CONFIG,
          useValue: {
            environment: 'local',
            bffWebBaseUrl: BFF,
            registrationPoliciesVersion: 'local-dev',
          } satisfies AppConfig,
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    refresher = TestBed.inject(HttpSessionRefresher);
    spyOn(Date, 'now').and.returnValue(NOW);
  });

  afterEach(() => http.verify());

  /** Espera a que la solicitud salga (puede pasar antes por el bloqueo entre pestañas). */
  async function nextRefreshRequest() {
    for (let attempt = 0; attempt < 20; attempt++) {
      const pending = http.match(REFRESH_URL);
      if (pending.length > 0) {
        return pending[0];
      }
      await new Promise((resolve) => setTimeout(resolve));
    }
    return http.expectOne(REFRESH_URL);
  }

  async function refreshWith(response: SimulatedResponse): Promise<RefreshOutcome> {
    const outcome = refresher.refresh();
    (await nextRefreshRequest()).flush(response.body as object, {
      status: response.status,
      statusText: 'simulado',
    });
    return outcome;
  }

  it('envía POST /v1/sessions/refresh sin cuerpo y con credenciales para que viaje la cookie', async () => {
    const outcome = refresher.refresh();
    const request = await nextRefreshRequest();
    request.flush(REFRESH_SESSION_RESPONSES.renewed.body);
    await outcome;

    expect(request.request.method).toBe('POST');
    expect(request.request.body).toBeNull();
    expect(request.request.withCredentials).toBeTrue();
  });

  it('200 → sesión renovada con el access token nuevo y su vencimiento', async () => {
    expect(await refreshWith(REFRESH_SESSION_RESPONSES.renewed)).toEqual({
      kind: 'renewed',
      session: {
        user: {
          id: '0b9f6c1e-3d2a-4f5b-8c7d-1e2f3a4b5c6d',
          fullName: 'Persona Sintética',
          email: 'persona@example.com',
          actorType: 'organizer',
        },
        accessToken: SIMULATED_RENEWED_ACCESS_TOKEN,
        expiresAt: NOW + 900_000,
      },
    });
  });

  it('CA10: 200 con un actor desconocido no produce sesión', async () => {
    const { body } = REFRESH_SESSION_RESPONSES.renewed;
    const outcome = await refreshWith({
      status: 200,
      body: { ...body, user: { ...body.user, actor_type: 'admin' } },
    });

    expect(outcome).toEqual({ kind: 'rejected' });
  });

  const rejected: [string, SimulatedResponse][] = [
    ['401 invalid_refresh_token', REFRESH_SESSION_RESPONSES.invalidRefreshToken],
    ['403 origin_not_allowed', REFRESH_SESSION_RESPONSES.originNotAllowed],
  ];
  for (const [name, response] of rejected) {
    it(`${name} → rechazada, sin reintento`, async () => {
      expect(await refreshWith(response)).toEqual({ kind: 'rejected' });
    });
  }

  const unavailable: [string, SimulatedResponse][] = [
    ['503 upstream_unavailable', REFRESH_SESSION_RESPONSES.upstreamUnavailable],
    ['504 upstream_timeout', REFRESH_SESSION_RESPONSES.upstreamTimeout],
  ];
  for (const [name, response] of unavailable) {
    it(`${name} → no disponible, se puede reintentar`, async () => {
      expect(await refreshWith(response)).toEqual({ kind: 'unavailable' });
    });
  }

  it('sin conexión → no disponible', async () => {
    const outcome = refresher.refresh();
    (await nextRefreshRequest()).error(new ProgressEvent('error'), { status: 0 });

    expect(await outcome).toEqual({ kind: 'unavailable' });
  });

  it('serializa las renovaciones entre pestañas con un bloqueo del navegador', async () => {
    if (!navigator.locks) {
      pending('El navegador de pruebas no ofrece la Web Locks API.');
      return;
    }
    const request = spyOn(navigator.locks, 'request').and.callThrough();

    const outcome = refresher.refresh();
    (await nextRefreshRequest()).flush(REFRESH_SESSION_RESPONSES.renewed.body);
    await outcome;

    expect(request).toHaveBeenCalledTimes(1);
    expect(request.calls.mostRecent().args[0]).toBe('sportapp-session-refresh');
  });

  it('sin Web Locks API renueva directamente', async () => {
    spyOnProperty(navigator, 'locks').and.returnValue(undefined as unknown as LockManager);

    expect(await refreshWith(REFRESH_SESSION_RESPONSES.renewed)).toEqual(
      jasmine.objectContaining({ kind: 'renewed' }),
    );
  });
});
