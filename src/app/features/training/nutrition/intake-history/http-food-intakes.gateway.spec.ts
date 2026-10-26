import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import {
  FOOD_INTAKES_RESPONSES,
  SIMULATED_INTAKES_ATHLETE_ID,
  SIMULATED_INTAKES_NEXT_CURSOR,
  foodIntake,
} from '../../../../../testing/bff-web/food-intakes.fixtures';
import { APP_CONFIG, AppConfig } from '../../../../core/config/app-config';
import { SessionStore } from '../../../../core/session/session.store';
import { NO_INTAKE_FILTERS } from './food-intakes.model';
import { HttpFoodIntakesGateway } from './http-food-intakes.gateway';

const BFF = 'http://bff.example.com';
const TOKEN = 'token-sintetico';
const OWN_URL = `${BFF}/v1/me/food-intakes`;
const ATHLETE_URL = `${BFF}/v1/athletes/${SIMULATED_INTAKES_ATHLETE_ID}/food-intakes`;

describe('HttpFoodIntakesGateway (HU013, contrato bff-web 0.32.0)', () => {
  let http: HttpTestingController;
  let session: SessionStore;
  let gateway: HttpFoodIntakesGateway;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        HttpFoodIntakesGateway,
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
    gateway = TestBed.inject(HttpFoodIntakesGateway);
    session.start({
      user: {
        id: SIMULATED_INTAKES_ATHLETE_ID,
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

  it('CA1: consulta los consumos propios con token, filtros y el tamaño de página del contrato', async () => {
    const page = gateway.loadPage(
      { kind: 'own' },
      { from: '2026-10-01', to: '2026-10-24', mealType: 'LUNCH' },
      null,
    );
    const request = http.expectOne((r) => r.url === OWN_URL);

    expect(request.request.method).toBe('GET');
    expect(request.request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
    expect(request.request.params.get('from')).toBe('2026-10-01');
    expect(request.request.params.get('to')).toBe('2026-10-24');
    expect(request.request.params.get('meal_type')).toBe('LUNCH');
    expect(request.request.params.get('limit')).toBe('20');
    expect(request.request.params.has('cursor')).toBeFalse();
    request.flush(FOOD_INTAKES_RESPONSES.firstPage.body);

    const result = await page;
    const first = foodIntake(0);
    expect(result.intakes.map((intake) => intake.id)).toEqual(
      FOOD_INTAKES_RESPONSES.firstPage.body.items.map((item) => item.intake_id),
    );
    expect(result.intakes[0]).toEqual({
      id: first.intake_id,
      consumedAt: first.consumed_at,
      mealType: 'DINNER',
      items: [{ foodCode: 'CHICKEN_BREAST', quantity: 150, unit: 'G' }],
    });
    expect(result.nextCursor).toBe(SIMULATED_INTAKES_NEXT_CURSOR);
  });

  it('CA4: pide la página siguiente del deportista con el cursor sin modificar y sin filtros vacíos', async () => {
    const page = gateway.loadPage(
      { kind: 'athlete', athleteId: SIMULATED_INTAKES_ATHLETE_ID },
      NO_INTAKE_FILTERS,
      SIMULATED_INTAKES_NEXT_CURSOR,
    );
    const request = http.expectOne((r) => r.url === ATHLETE_URL);

    expect(request.request.params.keys().sort()).toEqual(['cursor', 'limit']);
    expect(request.request.params.get('cursor')).toBe(SIMULATED_INTAKES_NEXT_CURSOR);
    request.flush(FOOD_INTAKES_RESPONSES.lastPage.body);

    expect((await page).nextCursor).toBeNull();
  });

  it('CA5: una colección vacía es una página vacía, sin error', async () => {
    const page = gateway.loadPage({ kind: 'own' }, NO_INTAKE_FILTERS, null);
    http.expectOne((r) => r.url === OWN_URL).flush(FOOD_INTAKES_RESPONSES.empty.body);

    expect(await page).toEqual({ intakes: [], nextCursor: null });
  });

  it('CA3: el rechazo del BFF llega como error, nunca como historial vacío', async () => {
    const page = gateway.loadPage(
      { kind: 'athlete', athleteId: SIMULATED_INTAKES_ATHLETE_ID },
      NO_INTAKE_FILTERS,
      null,
    );
    const rejected = FOOD_INTAKES_RESPONSES.athleteAuthorizationRequired;
    http
      .expectOne((r) => r.url === ATHLETE_URL)
      .flush(rejected.body, { status: 403, statusText: 'Forbidden' });

    await expectAsync(page).toBeRejectedWith(jasmine.any(HttpErrorResponse));
    expect(session.user()).not.toBeNull();
  });

  it('CA2: un 422 llega como error con sus detalles', async () => {
    const page = gateway.loadPage(
      { kind: 'own' },
      { from: '2026-10-24', to: '2026-10-01', mealType: null },
      null,
    );
    const rejected = FOOD_INTAKES_RESPONSES.toBeforeFrom;
    http
      .expectOne((r) => r.url === OWN_URL)
      .flush(rejected.body, { status: 422, statusText: 'Unprocessable Entity' });

    await expectAsync(page).toBeRejectedWith(
      jasmine.objectContaining({ status: 422, error: rejected.body }),
    );
  });

  it('401 invalid_access_token termina la sesión como vencida', async () => {
    const page = gateway.loadPage({ kind: 'own' }, NO_INTAKE_FILTERS, null);
    const rejected = FOOD_INTAKES_RESPONSES.invalidAccessToken;
    http
      .expectOne((r) => r.url === OWN_URL)
      .flush(rejected.body, { status: 401, statusText: 'Unauthorized' });

    await expectAsync(page).toBeRejected();
    expect(session.lastEndReason()).toBe('expired');
  });

  it('sin access token vigente no llama al BFF', async () => {
    session.end();

    await expectAsync(gateway.loadPage({ kind: 'own' }, NO_INTAKE_FILTERS, null)).toBeRejected();
    expect(session.lastEndReason()).toBe('expired');
    http.expectNone((r) => r.url === OWN_URL);
  });
});
