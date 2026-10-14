import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import {
  CREATE_SESSION_RESPONSES,
  SIMULATED_ACCESS_TOKEN,
  SIMULATED_RETRY_AFTER,
  SIMULATED_SESSION_CORRELATION_ID,
  VALID_LOGIN_REQUEST,
} from '../../../../testing/bff-web/create-session.fixtures';
import { SimulatedResponse } from '../../../../testing/bff-web/register-user.fixtures';
import { APP_CONFIG, AppConfig } from '../../../core/config/app-config';
import { HttpLoginGateway } from './http-login.gateway';
import { LoginOutcome } from './login.model';

const BFF = 'http://bff.example.com';
const NOW = new Date('2026-10-10T12:00:00Z').getTime();

describe('HttpLoginGateway (HU003, contrato bff-web 0.12.0)', () => {
  let http: HttpTestingController;
  let gateway: HttpLoginGateway;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        HttpLoginGateway,
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
    gateway = TestBed.inject(HttpLoginGateway);
    spyOn(Date, 'now').and.returnValue(NOW);
  });

  afterEach(() => http.verify());

  async function loginWith(
    response: SimulatedResponse,
    headers: Record<string, string> = {},
  ): Promise<LoginOutcome> {
    const outcome = gateway.login(VALID_LOGIN_REQUEST);
    const request = http.expectOne(`${BFF}/v1/sessions`);
    request.flush(response.body as object, {
      status: response.status,
      statusText: 'simulado',
      headers,
    });
    return outcome;
  }

  it('envía las credenciales a POST /v1/sessions con credenciales, para recibir la cookie', async () => {
    const outcome = gateway.login(VALID_LOGIN_REQUEST);
    const request = http.expectOne(`${BFF}/v1/sessions`);
    request.flush(CREATE_SESSION_RESPONSES.authenticated.body);
    await outcome;

    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual(VALID_LOGIN_REQUEST);
    expect(request.request.withCredentials).toBeTrue();
  });

  it('CA1: devuelve la identidad, el access token y su vencimiento verificable', async () => {
    const outcome = await loginWith(CREATE_SESSION_RESPONSES.authenticated);

    expect(outcome).toEqual({
      kind: 'authenticated',
      session: {
        user: {
          id: '0b9f6c1e-3d2a-4f5b-8c7d-1e2f3a4b5c6d',
          fullName: 'Persona Sintética',
          email: 'persona@example.com',
          actorType: 'organizer',
        },
        accessToken: SIMULATED_ACCESS_TOKEN,
        expiresAt: NOW + 900_000,
      },
    });
  });

  it('CA2/CA3: 401 invalid_credentials → mensaje genérico, sin sesión', async () => {
    expect(await loginWith(CREATE_SESSION_RESPONSES.invalidCredentials)).toEqual({
      kind: 'invalid_credentials',
    });
  });

  it('CA4: 429 too_many_attempts → control de abuso con Retry-After', async () => {
    const outcome = await loginWith(CREATE_SESSION_RESPONSES.tooManyAttempts, {
      'Retry-After': String(SIMULATED_RETRY_AFTER),
    });

    expect(outcome).toEqual({
      kind: 'too_many_attempts',
      retryAfterSeconds: SIMULATED_RETRY_AFTER,
    });
  });

  it('CA4: 429 sin Retry-After legible → espera sin plazo concreto', async () => {
    const outcome = await loginWith(CREATE_SESSION_RESPONSES.tooManyAttempts, {
      'Retry-After': 'mañana',
    });

    expect(outcome).toEqual({ kind: 'too_many_attempts', retryAfterSeconds: null });
  });

  const technicalFailures: [string, SimulatedResponse, string][] = [
    ['403 origin_not_allowed', CREATE_SESSION_RESPONSES.originNotAllowed, 'forbidden'],
    ['422 validation_error', CREATE_SESSION_RESPONSES.validationError, 'validation'],
    ['503 upstream_unavailable', CREATE_SESSION_RESPONSES.upstreamUnavailable, 'server'],
    ['504 upstream_timeout', CREATE_SESSION_RESPONSES.upstreamTimeout, 'server'],
  ];
  for (const [name, response, kind] of technicalFailures) {
    it(`${name} → fallo trazable, nunca sesión`, async () => {
      expect(await loginWith(response)).toEqual({
        kind: 'failed',
        error: {
          kind: kind as 'forbidden' | 'validation' | 'server',
          status: response.status,
          code: (response.body as { code: string }).code,
          correlationId: SIMULATED_SESSION_CORRELATION_ID,
        },
      });
    });
  }

  it('CA10: un actor_type desconocido no produce sesión', async () => {
    const outcome = await loginWith({
      status: 200,
      body: {
        ...CREATE_SESSION_RESPONSES.authenticated.body,
        user: { ...CREATE_SESSION_RESPONSES.authenticated.body.user, actor_type: 'admin' },
      },
    });

    expect(outcome).toEqual({ kind: 'unauthorized_actor' });
  });

  it('CA10: un actor_type ausente no asume un rol predeterminado', async () => {
    const user: Record<string, unknown> = { ...CREATE_SESSION_RESPONSES.authenticated.body.user };
    delete user['actor_type'];
    const outcome = await loginWith({
      status: 200,
      body: { ...CREATE_SESSION_RESPONSES.authenticated.body, user },
    });

    expect(outcome).toEqual({ kind: 'unauthorized_actor' });
  });

  it('un 401 que no es invalid_credentials no se presenta como credenciales incorrectas', async () => {
    const outcome = await loginWith({ status: 401, body: { detail: 'otro' } });

    expect(outcome.kind).toBe('failed');
  });

  it('sin conexión → fallo de tipo offline', async () => {
    const outcome = gateway.login(VALID_LOGIN_REQUEST);
    http.expectOne(`${BFF}/v1/sessions`).error(new ProgressEvent('error'), { status: 0 });

    expect(await outcome).toEqual({
      kind: 'failed',
      error: { kind: 'offline', status: null, code: null, correlationId: null },
    });
  });
});
