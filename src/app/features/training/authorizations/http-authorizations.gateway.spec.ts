import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { SimulatedResponse } from '../../../../testing/bff-web/register-user.fixtures';
import {
  GRANT_AUTHORIZATION_RESPONSES,
  REVOKE_AUTHORIZATION_RESPONSES,
  SIMULATED_ATHLETE_ID,
  SIMULATED_PROFESSIONAL_ID,
} from '../../../../testing/bff-web/training.fixtures';
import { APP_CONFIG, AppConfig } from '../../../core/config/app-config';
import { SessionStore } from '../../../core/session/session.store';
import { GrantOutcome } from './authorizations.model';
import { HttpAuthorizationsGateway } from './http-authorizations.gateway';

const BFF = 'http://bff.example.com';
const TOKEN = 'token-sintetico';
const EMAIL = 'profesional@example.com';
const GRANT_URL = `${BFF}/v1/me/training-authorizations`;
const REVOKE_URL = `${GRANT_URL}/${SIMULATED_PROFESSIONAL_ID}`;

describe('HttpAuthorizationsGateway (HU010, contrato bff-web 0.12.0)', () => {
  let http: HttpTestingController;
  let session: SessionStore;
  let gateway: HttpAuthorizationsGateway;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        HttpAuthorizationsGateway,
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
    session = TestBed.inject(SessionStore);
    gateway = TestBed.inject(HttpAuthorizationsGateway);
    session.start({
      user: {
        id: SIMULATED_ATHLETE_ID,
        fullName: 'Deportista Sintética',
        email: 'deportista@example.com',
        actorType: 'athlete',
      },
      accessToken: TOKEN,
      expiresAt: Date.now() + 600_000,
    });
  });

  afterEach(() => {
    http.verify();
    session.end();
  });

  async function grantWith(response: SimulatedResponse): Promise<GrantOutcome> {
    const outcome = gateway.grant(EMAIL);
    http
      .expectOne(GRANT_URL)
      .flush(response.body as object, { status: response.status, statusText: 'simulado' });
    return outcome;
  }

  it('autoriza con el correo exacto y el token del deportista', async () => {
    const outcome = gateway.grant(EMAIL);
    const request = http.expectOne(GRANT_URL);

    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
    expect(request.request.body).toEqual({ professional_email: EMAIL });
    request.flush(GRANT_AUTHORIZATION_RESPONSES.granted.body, {
      status: 201,
      statusText: 'Created',
    });

    expect(await outcome).toEqual({
      kind: 'granted',
      authorization: {
        professionalEmail: EMAIL,
        professionalId: SIMULATED_PROFESSIONAL_ID,
        status: 'ACTIVE',
        grantedAt: '2026-10-12T15:30:00Z',
        alreadyActive: false,
      },
    });
  });

  it('distingue una autorización que ya estaba activa (200)', async () => {
    const outcome = await grantWith(GRANT_AUTHORIZATION_RESPONSES.alreadyActive);

    expect(outcome.kind === 'granted' && outcome.authorization.alreadyActive).toBeTrue();
  });

  it('un correo que no es de un profesional se informa como tal', async () => {
    expect(await grantWith(GRANT_AUTHORIZATION_RESPONSES.professionalNotFound)).toEqual({
      kind: 'professional_not_found',
    });
  });

  it('validation_error marca el correo como inválido', async () => {
    expect(await grantWith(GRANT_AUTHORIZATION_RESPONSES.validationError)).toEqual({
      kind: 'invalid_email',
    });
  });

  for (const name of [
    'capabilityRequired',
    'permissionRequired',
    'upstreamUnavailable',
    'upstreamTimeout',
  ] as const) {
    it(`${name}: falla de forma trazable`, async () => {
      const response = GRANT_AUTHORIZATION_RESPONSES[name];
      const outcome = await grantWith(response);

      expect(outcome.kind === 'failed' && outcome.error.code).toBe(response.body.code);
    });
  }

  it('401 invalid_access_token termina la sesión como vencida', async () => {
    await grantWith(GRANT_AUTHORIZATION_RESPONSES.invalidAccessToken);

    expect(session.lastEndReason()).toBe('expired');
  });

  it('revoca por identificador del profesional y lo confirma solo con 204', async () => {
    const outcome = gateway.revoke(SIMULATED_PROFESSIONAL_ID);
    const request = http.expectOne(REVOKE_URL);

    expect(request.request.method).toBe('DELETE');
    expect(request.request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
    request.flush(null, { status: 204, statusText: 'No Content' });

    expect(await outcome).toEqual({ kind: 'revoked' });
  });

  it('una revocación fallida no se presenta como revocada', async () => {
    const outcome = gateway.revoke(SIMULATED_PROFESSIONAL_ID);
    const response = REVOKE_AUTHORIZATION_RESPONSES.upstreamUnavailable;
    http.expectOne(REVOKE_URL).flush(response.body, { status: 503, statusText: 'simulado' });

    expect(await outcome).toEqual(
      jasmine.objectContaining({
        kind: 'failed',
        error: jasmine.objectContaining({ kind: 'server', code: 'upstream_unavailable' }),
      }),
    );
  });

  it('sin access token vigente no llama al BFF', async () => {
    session.end();

    expect((await gateway.grant(EMAIL)).kind).toBe('failed');
    expect((await gateway.revoke(SIMULATED_PROFESSIONAL_ID)).kind).toBe('failed');
    http.expectNone(GRANT_URL);
    http.expectNone(REVOKE_URL);
  });
});
