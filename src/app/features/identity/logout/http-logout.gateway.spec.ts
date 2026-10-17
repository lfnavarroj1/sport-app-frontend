import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { SimulatedResponse } from '../../../../testing/bff-web/register-user.fixtures';
import {
  REVOKE_SESSION_RESPONSES,
  SIMULATED_REVOKE_CORRELATION_ID,
} from '../../../../testing/bff-web/revoke-session.fixtures';
import { APP_CONFIG, AppConfig } from '../../../core/config/app-config';
import { HttpLogoutGateway } from './http-logout.gateway';

const BFF = 'http://bff.example.com';
const URL = `${BFF}/v1/sessions/revoke`;

describe('HttpLogoutGateway (HU004, contrato bff-web 0.13.0)', () => {
  let http: HttpTestingController;
  let gateway: HttpLogoutGateway;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        HttpLogoutGateway,
        {
          provide: APP_CONFIG,
          useValue: {
            environment: 'local',
            bffWebBaseUrl: BFF,
            registrationPoliciesVersion: null,
            healthDataConsentVersion: null,
          } satisfies AppConfig,
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    gateway = TestBed.inject(HttpLogoutGateway);
  });

  afterEach(() => http.verify());

  function respond(response: SimulatedResponse): void {
    const request = http.expectOne(URL);
    if (response.status === 0) {
      request.error(new ProgressEvent('error'));
    } else {
      request.flush(response.body as object | null, {
        status: response.status,
        statusText: 'simulado',
      });
    }
  }

  it('CA1: con 204 la sesión queda revocada; la solicitud solo lleva la cookie', async () => {
    const outcome = gateway.logout();
    const request = http.expectOne(URL);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toBeNull();
    expect(request.request.withCredentials).toBeTrue();
    expect(request.request.headers.has('Authorization')).toBeFalse();
    request.flush(null, { status: 204, statusText: 'No Content' });

    expect(await outcome).toEqual({ kind: 'revoked' });
  });

  for (const name of ['upstreamUnavailable', 'upstreamTimeout'] as const) {
    it(`${REVOKE_SESSION_RESPONSES[name].status}: el BFF borró la cookie, pero la revocación no se confirmó`, async () => {
      const outcome = gateway.logout();
      respond(REVOKE_SESSION_RESPONSES[name]);

      expect(await outcome).toEqual({ kind: 'unconfirmed' });
    });
  }

  it('sin conexión la cookie sigue viva: no es un cierre', async () => {
    const outcome = gateway.logout();
    respond({ status: 0, body: null });

    expect(await outcome).toEqual({
      kind: 'failed',
      error: { kind: 'offline', status: null, code: null, correlationId: null },
    });
  });

  it('403 origin_not_allowed no toca la cookie: fallo trazable', async () => {
    const outcome = gateway.logout();
    respond(REVOKE_SESSION_RESPONSES.originNotAllowed);

    expect(await outcome).toEqual({
      kind: 'failed',
      error: {
        kind: 'forbidden',
        status: 403,
        code: 'origin_not_allowed',
        correlationId: SIMULATED_REVOKE_CORRELATION_ID,
      },
    });
  });

  it('un 503 que no viene del BFF (sin código del contrato) no se da por cierre', async () => {
    const outcome = gateway.logout();
    respond({ status: 503, body: { message: 'proxy' } });

    expect((await outcome).kind).toBe('failed');
  });

  it('un 502 de un intermediario no garantiza que la cookie se borró', async () => {
    const outcome = gateway.logout();
    respond({ status: 502, body: null });

    expect((await outcome).kind).toBe('failed');
  });
});
