import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import {
  HEALTH_REPORTS_RESPONSES,
  SIMULATED_HEALTH_ATHLETE_ID,
  healthReport,
} from '../../../../testing/bff-web/health-reports.fixtures';
import { APP_CONFIG, AppConfig } from '../../../core/config/app-config';
import { SessionStore } from '../../../core/session/session.store';
import { NO_HEALTH_FILTERS } from './health-history.model';
import { HttpHealthHistoryGateway } from './http-health-history.gateway';

const BFF = 'http://bff.example.com';
const TOKEN = 'token-sintetico';
const OWN_URL = `${BFF}/v1/me/health-reports`;
const ATHLETE_URL = `${BFF}/v1/athletes/${SIMULATED_HEALTH_ATHLETE_ID}/health-reports`;

describe('HttpHealthHistoryGateway (HU012, contrato bff-web 0.33.0)', () => {
  let http: HttpTestingController;
  let session: SessionStore;
  let gateway: HttpHealthHistoryGateway;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        HttpHealthHistoryGateway,
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
    gateway = TestBed.inject(HttpHealthHistoryGateway);
    session.start({
      user: {
        id: SIMULATED_HEALTH_ATHLETE_ID,
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

  it('CA1: consulta los reportes propios con token, filtros y el tamaño de página del contrato', async () => {
    const page = gateway.loadPage(
      { kind: 'own' },
      { from: '2026-10-01', to: '2026-10-20', type: 'INJURY', severity: 'HIGH' },
      null,
    );
    const request = http.expectOne((r) => r.url === OWN_URL);

    expect(request.request.method).toBe('GET');
    expect(request.request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
    expect(request.request.params.get('from')).toBe('2026-10-01');
    expect(request.request.params.get('to')).toBe('2026-10-20');
    expect(request.request.params.get('type')).toBe('INJURY');
    expect(request.request.params.get('severity')).toBe('HIGH');
    expect(request.request.params.get('limit')).toBe('20');
    expect(request.request.params.has('cursor')).toBeFalse();
    request.flush(HEALTH_REPORTS_RESPONSES.firstPage.body);

    const result = await page;
    const first = healthReport(0);
    expect(result.reports.map((report) => report.id)).toEqual(
      HEALTH_REPORTS_RESPONSES.firstPage.body.items.map((item) => item.report_id),
    );
    expect(result.reports[0]).toEqual({
      id: first.report_id,
      type: first.type,
      bodyArea: first.body_area,
      severity: first.severity,
      occurredAt: first.occurred_at,
      expectedRecoveryDays: first.expected_recovery_days,
      status: first.status,
      sessionId: first.session_id,
    });
    expect(result.nextCursor).toBe('cursor-sintetico-salud-2');
  });

  it('CA2/CA6: el profesional pide la página siguiente con el cursor sin modificar y sin filtros vacíos', async () => {
    const page = gateway.loadPage(
      { kind: 'athlete', athleteId: SIMULATED_HEALTH_ATHLETE_ID },
      NO_HEALTH_FILTERS,
      'cursor-sintetico-salud-2',
    );
    const request = http.expectOne((r) => r.url === ATHLETE_URL);

    expect(request.request.params.keys().sort()).toEqual(['cursor', 'limit']);
    expect(request.request.params.get('cursor')).toBe('cursor-sintetico-salud-2');
    request.flush(HEALTH_REPORTS_RESPONSES.lastPage.body);

    expect((await page).nextCursor).toBeNull();
  });

  it('CA4: una colección vacía es un historial vacío explícito', async () => {
    const page = gateway.loadPage({ kind: 'own' }, NO_HEALTH_FILTERS, null);
    http.expectOne((r) => r.url === OWN_URL).flush(HEALTH_REPORTS_RESPONSES.empty.body);

    expect(await page).toEqual({ reports: [], nextCursor: null });
  });

  it('CA3: el rechazo del BFF llega como error, nunca como historial vacío', async () => {
    const page = gateway.loadPage(
      { kind: 'athlete', athleteId: SIMULATED_HEALTH_ATHLETE_ID },
      NO_HEALTH_FILTERS,
      null,
    );
    const rejected = HEALTH_REPORTS_RESPONSES.athleteAuthorizationRequired;
    http
      .expectOne((r) => r.url === ATHLETE_URL)
      .flush(rejected.body, { status: 403, statusText: 'Forbidden' });

    await expectAsync(page).toBeRejectedWith(jasmine.any(HttpErrorResponse));
    expect(session.user()).not.toBeNull();
  });

  it('CA5: no registra en consola los datos ni los errores de salud', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      spyOn(console, method),
    );
    const ok = gateway.loadPage({ kind: 'own' }, NO_HEALTH_FILTERS, null);
    http.expectOne((r) => r.url === OWN_URL).flush(HEALTH_REPORTS_RESPONSES.firstPage.body);
    await ok;
    const failed = gateway.loadPage({ kind: 'own' }, NO_HEALTH_FILTERS, null);
    http
      .expectOne((r) => r.url === OWN_URL)
      .flush(HEALTH_REPORTS_RESPONSES.validationError.body, {
        status: 422,
        statusText: 'Unprocessable Entity',
      });
    await expectAsync(failed).toBeRejected();

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it('401 invalid_access_token termina la sesión como vencida', async () => {
    const page = gateway.loadPage({ kind: 'own' }, NO_HEALTH_FILTERS, null);
    const rejected = HEALTH_REPORTS_RESPONSES.invalidAccessToken;
    http
      .expectOne((r) => r.url === OWN_URL)
      .flush(rejected.body, { status: 401, statusText: 'Unauthorized' });

    await expectAsync(page).toBeRejected();
    expect(session.lastEndReason()).toBe('expired');
  });

  it('sin access token vigente no llama al BFF', async () => {
    session.end();

    await expectAsync(gateway.loadPage({ kind: 'own' }, NO_HEALTH_FILTERS, null)).toBeRejected();
    expect(session.lastEndReason()).toBe('expired');
    http.expectNone((r) => r.url === OWN_URL);
  });
});
