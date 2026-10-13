import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import {
  SIMULATED_HISTORY_ATHLETE_ID,
  TRAINING_HISTORY_RESPONSES,
  historyItem,
} from '../../../../testing/bff-web/training-history.fixtures';
import { APP_CONFIG, AppConfig } from '../../../core/config/app-config';
import { SessionStore } from '../../../core/session/session.store';
import { NO_FILTERS } from './history.model';
import { HttpHistoryGateway } from './http-history.gateway';

const BFF = 'http://bff.example.com';
const TOKEN = 'token-sintetico';
const OWN_URL = `${BFF}/v1/training-history`;
const ATHLETE_URL = `${BFF}/v1/athletes/${SIMULATED_HISTORY_ATHLETE_ID}/training-history`;

describe('HttpHistoryGateway (HU011, contrato bff-web 0.10.0)', () => {
  let http: HttpTestingController;
  let session: SessionStore;
  let gateway: HttpHistoryGateway;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        HttpHistoryGateway,
        {
          provide: APP_CONFIG,
          useValue: {
            environment: 'local',
            bffWebBaseUrl: BFF,
            registrationPoliciesVersion: null,
          } satisfies AppConfig,
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    session = TestBed.inject(SessionStore);
    gateway = TestBed.inject(HttpHistoryGateway);
    session.start({
      user: {
        id: SIMULATED_HISTORY_ATHLETE_ID,
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

  it('CA1: consulta el historial propio con token, filtros y el tamaño de página del contrato', async () => {
    const page = gateway.loadPage(
      { kind: 'own' },
      { from: '2026-10-01', to: '2026-10-12', sport: 'running' },
      null,
    );
    const request = http.expectOne((r) => r.url === OWN_URL);

    expect(request.request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
    expect(request.request.params.get('from')).toBe('2026-10-01');
    expect(request.request.params.get('to')).toBe('2026-10-12');
    expect(request.request.params.get('sport')).toBe('running');
    expect(request.request.params.get('limit')).toBe('20');
    expect(request.request.params.has('cursor')).toBeFalse();
    request.flush(TRAINING_HISTORY_RESPONSES.firstPage.body);

    const result = await page;
    const first = historyItem(0);
    expect(result.sessions.map((session) => session.id)).toEqual(
      TRAINING_HISTORY_RESPONSES.firstPage.body.items.map((item) => item.session_id),
    );
    expect(result.sessions[0]).toEqual({
      id: first.session_id,
      planId: first.plan_id,
      sport: first.sport,
      startedAt: first.started_at,
      endedAt: first.ended_at,
      durationSeconds: first.duration_seconds,
    });
    expect(result.nextCursor).toBe('cursor-sintetico-pagina-2');
    expect(result.availableSports).toEqual(['running', 'cycling', 'swimming']);
  });

  it('CA4: pide la página siguiente con el cursor sin modificar y sin filtros vacíos', async () => {
    const page = gateway.loadPage(
      { kind: 'athlete', athleteId: SIMULATED_HISTORY_ATHLETE_ID },
      NO_FILTERS,
      'cursor-sintetico-pagina-2',
    );
    const request = http.expectOne((r) => r.url === ATHLETE_URL);

    expect(request.request.params.keys().sort()).toEqual(['cursor', 'limit']);
    expect(request.request.params.get('cursor')).toBe('cursor-sintetico-pagina-2');
    request.flush(TRAINING_HISTORY_RESPONSES.lastPage.body);

    expect((await page).nextCursor).toBeNull();
  });

  it('CA2: una colección vacía conserva los filtros disponibles', async () => {
    const page = gateway.loadPage({ kind: 'own' }, NO_FILTERS, null);
    http.expectOne((r) => r.url === OWN_URL).flush(TRAINING_HISTORY_RESPONSES.empty.body);

    expect(await page).toEqual({ sessions: [], nextCursor: null, availableSports: [] });
  });

  it('CA3: el rechazo del BFF llega como error, nunca como historial vacío', async () => {
    const page = gateway.loadPage(
      { kind: 'athlete', athleteId: SIMULATED_HISTORY_ATHLETE_ID },
      NO_FILTERS,
      null,
    );
    const rejected = TRAINING_HISTORY_RESPONSES.athleteAuthorizationRequired;
    http
      .expectOne((r) => r.url === ATHLETE_URL)
      .flush(rejected.body, { status: 403, statusText: 'Forbidden' });

    await expectAsync(page).toBeRejectedWith(jasmine.any(HttpErrorResponse));
    expect(session.user()).not.toBeNull();
  });

  it('401 invalid_access_token termina la sesión como vencida', async () => {
    const page = gateway.loadPage({ kind: 'own' }, NO_FILTERS, null);
    const rejected = TRAINING_HISTORY_RESPONSES.invalidAccessToken;
    http
      .expectOne((r) => r.url === OWN_URL)
      .flush(rejected.body, { status: 401, statusText: 'Unauthorized' });

    await expectAsync(page).toBeRejected();
    expect(session.lastEndReason()).toBe('expired');
  });

  it('sin access token vigente no llama al BFF', async () => {
    session.end();

    await expectAsync(gateway.loadPage({ kind: 'own' }, NO_FILTERS, null)).toBeRejected();
    expect(session.lastEndReason()).toBe('expired');
    http.expectNone((r) => r.url === OWN_URL);
  });
});
