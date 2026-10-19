import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import {
  TRAINING_ATHLETES_RESPONSES,
  trainingAthlete,
} from '../../../../../testing/bff-web/training-history.fixtures';
import { APP_CONFIG, AppConfig } from '../../../../core/config/app-config';
import { SessionStore } from '../../../../core/session/session.store';
import { HttpAuthorizedAthletesGateway } from './http-authorized-athletes.gateway';

const BFF = 'http://bff.example.com';
const TOKEN = 'token-sintetico';
const URL = `${BFF}/v1/me/training-athletes`;

describe('HttpAuthorizedAthletesGateway (HU011 CA5, contrato bff-web 0.16.0)', () => {
  let http: HttpTestingController;
  let session: SessionStore;
  let gateway: HttpAuthorizedAthletesGateway;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        HttpAuthorizedAthletesGateway,
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
    gateway = TestBed.inject(HttpAuthorizedAthletesGateway);
    session.start({
      user: {
        id: '2f4a6c8e-0b1d-4e3f-9a5b-7c9d1e3f5a7b',
        fullName: 'Profesional Sintético',
        email: 'profesional@example.com',
        actorType: 'service_provider',
      },
      accessToken: TOKEN,
      expiresAt: Date.now() + 600_000,
    });
  });

  afterEach(() => {
    http.verify();
    session.end();
  });

  it('pide la primera página con token y el tamaño del contrato, sin identificadores', async () => {
    const page = gateway.loadPage(null);
    const request = http.expectOne((r) => r.url === URL);

    expect(request.request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
    expect(request.request.params.keys()).toEqual(['limit']);
    expect(request.request.params.get('limit')).toBe('20');
    request.flush(TRAINING_ATHLETES_RESPONSES.firstPage.body);

    const result = await page;
    const first = trainingAthlete(0);
    expect(result.athletes[0]).toEqual({
      id: first.athlete_id,
      fullName: first.full_name,
      email: first.email,
      authorizedAt: first.authorized_at,
    });
    expect(result.athletes.map((athlete) => athlete.id)).toEqual(
      TRAINING_ATHLETES_RESPONSES.firstPage.body.items.map((item) => item.athlete_id),
    );
    expect(result.nextCursor).toBe('cursor-sintetico-deportistas-2');
  });

  it('pide la página siguiente con el cursor sin modificar', async () => {
    const page = gateway.loadPage('cursor-sintetico-deportistas-2');
    const request = http.expectOne((r) => r.url === URL);

    expect(request.request.params.get('cursor')).toBe('cursor-sintetico-deportistas-2');
    request.flush(TRAINING_ATHLETES_RESPONSES.lastPage.body);

    expect((await page).nextCursor).toBeNull();
  });

  it('una lista vacía llega como página vacía', async () => {
    const page = gateway.loadPage(null);
    http.expectOne((r) => r.url === URL).flush(TRAINING_ATHLETES_RESPONSES.empty.body);

    expect(await page).toEqual({ athletes: [], nextCursor: null });
  });

  it('un 503 (enriquecimiento incompleto) llega como error, nunca como lista vacía', async () => {
    const page = gateway.loadPage(null);
    const failed = TRAINING_ATHLETES_RESPONSES.upstreamUnavailable;
    http
      .expectOne((r) => r.url === URL)
      .flush(failed.body, { status: 503, statusText: 'Service Unavailable' });

    await expectAsync(page).toBeRejectedWith(jasmine.any(HttpErrorResponse));
    expect(session.user()).not.toBeNull();
  });

  it('401 invalid_access_token termina la sesión como vencida', async () => {
    const page = gateway.loadPage(null);
    const rejected = TRAINING_ATHLETES_RESPONSES.invalidAccessToken;
    http
      .expectOne((r) => r.url === URL)
      .flush(rejected.body, { status: 401, statusText: 'Unauthorized' });

    await expectAsync(page).toBeRejected();
    expect(session.lastEndReason()).toBe('expired');
  });

  it('sin access token vigente no llama al BFF', async () => {
    session.end();

    await expectAsync(gateway.loadPage(null)).toBeRejected();
    expect(session.lastEndReason()).toBe('expired');
    http.expectNone((r) => r.url === URL);
  });
});
