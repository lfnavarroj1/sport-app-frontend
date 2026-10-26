import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import {
  INTEGRATED_CALENDAR_RESPONSES,
  MARCH_2027,
} from '../../../../testing/bff-web/integrated-calendar.fixtures';
import { SimulatedResponse } from '../../../../testing/bff-web/register-user.fixtures';
import { APP_CONFIG, AppConfig } from '../../../core/config/app-config';
import { SessionStore } from '../../../core/session/session.store';
import { HttpIntegratedCalendarGateway } from './http-integrated-calendar.gateway';

const BFF = 'http://bff.example.com';
const URL = `${BFF}/v1/me/integrated-calendar`;
const TOKEN = 'token-sintetico';

describe('HttpIntegratedCalendarGateway (HU018, contrato bff-web 0.30.0)', () => {
  let http: HttpTestingController;
  let session: SessionStore;
  let gateway: HttpIntegratedCalendarGateway;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        HttpIntegratedCalendarGateway,
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
    gateway = TestBed.inject(HttpIntegratedCalendarGateway);
    session.start({
      user: {
        id: '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f',
        fullName: 'Deportista Sintético',
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

  function flush(response: SimulatedResponse): void {
    http
      .expectOne((r) => r.url === URL)
      .flush(response.body as object, {
        status: response.status,
        statusText: String(response.status),
      });
  }

  it('consulta el periodo con el access token y transforma la respuesta', async () => {
    const result = gateway.load(MARCH_2027);
    const request = http.expectOne((r) => r.url === URL);

    expect(request.request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
    expect(request.request.params.get('from')).toBe(MARCH_2027.from);
    expect(request.request.params.get('to')).toBe(MARCH_2027.to);
    request.flush(INTEGRATED_CALENDAR_RESPONSES.athlete.body);

    const calendar = await result;
    expect(calendar.items.length).toBe(4);
    expect(calendar.sources.every((source) => source.status === 'OK')).toBeTrue();
  });

  it('entrega el resultado parcial tal como lo declara el BFF (CA5)', async () => {
    const result = gateway.load(MARCH_2027);
    flush(INTEGRATED_CALENDAR_RESPONSES.athletePartial);

    const calendar = await result;
    expect(calendar.items.map((item) => item.source)).toEqual([
      'EVENT_PUBLISHED',
      'EVENT_REGISTRATION',
    ]);
    expect(calendar.sources.filter((source) => source.status !== 'OK').length).toBe(2);
  });

  for (const key of ['upstreamUnavailable', 'upstreamTimeout', 'permissionRequired'] as const) {
    it(`rechaza con el error original ante ${key}: nunca un calendario vacío`, async () => {
      const result = gateway.load(MARCH_2027);
      flush(INTEGRATED_CALENDAR_RESPONSES[key]);

      await expectAsync(result).toBeRejectedWith(jasmine.any(HttpErrorResponse));
      expect(session.isAuthenticated()).toBeTrue();
    });
  }

  it('termina la sesión si el BFF rechaza el access token', async () => {
    const result = gateway.load(MARCH_2027);
    flush(INTEGRATED_CALENDAR_RESPONSES.invalidAccessToken);

    await expectAsync(result).toBeRejected();
    expect(session.isAuthenticated()).toBeFalse();
    expect(session.lastEndReason()).toBe('expired');
  });

  it('sin access token vigente no llama al BFF y termina la sesión', async () => {
    session.end();

    await expectAsync(gateway.load(MARCH_2027)).toBeRejectedWith(jasmine.any(HttpErrorResponse));
    expect(session.lastEndReason()).toBe('expired');
    http.expectNone(URL);
  });
});
