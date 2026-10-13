import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { SimulatedResponse } from '../../../../testing/bff-web/register-user.fixtures';
import {
  CREATE_TRAINING_PLAN_RESPONSES,
  GET_TRAINING_PLAN_RESPONSES,
  SIMULATED_ATHLETE_ID,
  SIMULATED_PLAN_ID,
  SIMULATED_PROFESSIONAL_ID,
  SIMULATED_TRAINING_CORRELATION_ID,
  VALID_CREATE_TRAINING_PLAN_REQUEST,
} from '../../../../testing/bff-web/training.fixtures';
import { APP_CONFIG, AppConfig } from '../../../core/config/app-config';
import { SessionStore } from '../../../core/session/session.store';
import { HttpPlanAuthoringGateway } from './http-plan-authoring.gateway';
import { CreatePlanOutcome, PlanDraft } from './plan-authoring.model';

const BFF = 'http://bff.example.com';
const KEY = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
const TOKEN = 'token-sintetico';

const DRAFT: PlanDraft = {
  athleteEmail: 'deportista@example.com',
  title: 'Base aeróbica de 8 semanas',
  objectives: ['Mejorar la resistencia aeróbica', 'Preparar una carrera de 10 km'],
  startDate: '2026-11-02',
  endDate: '2026-12-27',
  sessions: [
    { scheduledDate: '2026-11-03', sport: 'running', durationMinutes: 45, intensityRpe: 4 },
    { scheduledDate: '2026-11-05', sport: 'cycling', durationMinutes: 60, intensityRpe: 6 },
  ],
};

describe('HttpPlanAuthoringGateway (HU010, contrato bff-web 0.6.0)', () => {
  let http: HttpTestingController;
  let session: SessionStore;
  let gateway: HttpPlanAuthoringGateway;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        HttpPlanAuthoringGateway,
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
    gateway = TestBed.inject(HttpPlanAuthoringGateway);
    session.start({
      user: {
        id: SIMULATED_PROFESSIONAL_ID,
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

  async function createWith(
    response: SimulatedResponse,
    headers: Record<string, string> = {},
  ): Promise<CreatePlanOutcome> {
    const outcome = gateway.createPlan(DRAFT, KEY);
    http.expectOne(`${BFF}/v1/training-plans`).flush(response.body as object, {
      status: response.status,
      statusText: 'simulado',
      headers,
    });
    return outcome;
  }

  describe('createPlan', () => {
    it('envía el borrador como CreateTrainingPlanRequest con el token y la clave de idempotencia', async () => {
      const outcome = gateway.createPlan(DRAFT, KEY);
      const request = http.expectOne(`${BFF}/v1/training-plans`);

      expect(request.request.method).toBe('POST');
      expect(request.request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
      expect(request.request.headers.get('Idempotency-Key')).toBe(KEY);
      expect(request.request.body).toEqual(VALID_CREATE_TRAINING_PLAN_REQUEST);
      request.flush(CREATE_TRAINING_PLAN_RESPONSES.created.body, {
        status: 201,
        statusText: 'Created',
      });
      await outcome;
    });

    it('CA1 y CA4: devuelve el plan asignado, con deportista, creador y periodo, sin datos de perfil', async () => {
      const outcome = await createWith(CREATE_TRAINING_PLAN_RESPONSES.created);

      expect(outcome).toEqual({
        kind: 'created',
        replayed: false,
        plan: {
          id: SIMULATED_PLAN_ID,
          athleteId: SIMULATED_ATHLETE_ID,
          professionalId: SIMULATED_PROFESSIONAL_ID,
          title: DRAFT.title,
          objectives: [...DRAFT.objectives],
          startDate: DRAFT.startDate,
          endDate: DRAFT.endDate,
          status: 'ASSIGNED',
          version: 1,
          sessions: [...DRAFT.sessions],
          createdAt: '2026-10-12T16:00:00Z',
        },
      });
    });

    it('CA5: reconoce el resultado de un reintento por Idempotent-Replayed', async () => {
      const outcome = await createWith(CREATE_TRAINING_PLAN_RESPONSES.created, {
        'Idempotent-Replayed': 'true',
      });

      expect(outcome.kind === 'created' && outcome.replayed).toBeTrue();
    });

    it('CA2: el deportista sin autorización (o correo inexistente) se informa como tal', async () => {
      expect(await createWith(CREATE_TRAINING_PLAN_RESPONSES.athleteAuthorizationRequired)).toEqual(
        {
          kind: 'athlete_not_authorized',
        },
      );
    });

    it('CA2: un rol sin permiso es un rechazo prohibido, no un éxito', async () => {
      const outcome = await createWith(CREATE_TRAINING_PLAN_RESPONSES.permissionRequired);

      expect(outcome).toEqual({
        kind: 'failed',
        error: {
          kind: 'forbidden',
          status: 403,
          code: 'permission_required',
          correlationId: SIMULATED_TRAINING_CORRELATION_ID,
        },
      });
    });

    it('CA3: traduce training_plan_invalid a las reglas incumplidas, sin el prefijo body.', async () => {
      expect(await createWith(CREATE_TRAINING_PLAN_RESPONSES.trainingPlanInvalid)).toEqual({
        kind: 'invalid',
        violations: [
          { path: 'end_date', issue: 'end_date_before_start_date' },
          { path: 'sessions.1.scheduled_date', issue: 'outside_plan_period' },
          { path: 'sessions.1.scheduled_date', issue: 'too_many_sessions_per_day' },
        ],
      });
    });

    it('CA3: validation_error también se informa por campo', async () => {
      expect(await createWith(CREATE_TRAINING_PLAN_RESPONSES.validationError)).toEqual({
        kind: 'invalid',
        violations: [{ path: 'sessions.0.intensity_rpe', issue: 'less_than_equal' }],
      });
    });

    for (const name of [
      'idempotencyKeyReused',
      'upstreamUnavailable',
      'upstreamTimeout',
    ] as const) {
      it(`${name}: falla de forma trazable, nunca como éxito`, async () => {
        const response = CREATE_TRAINING_PLAN_RESPONSES[name];
        const outcome = await createWith(response);

        expect(outcome.kind).toBe('failed');
        expect(outcome.kind === 'failed' && outcome.error.code).toBe(response.body.code);
        expect(outcome.kind === 'failed' && outcome.error.correlationId).toBe(
          SIMULATED_TRAINING_CORRELATION_ID,
        );
      });
    }

    it('sin conexión falla como offline', async () => {
      const outcome = gateway.createPlan(DRAFT, KEY);
      http.expectOne(`${BFF}/v1/training-plans`).error(new ProgressEvent('error'));

      expect(await outcome).toEqual(jasmine.objectContaining({ kind: 'failed' }));
      expect(((await outcome) as { error: { kind: string } }).error.kind).toBe('offline');
    });

    it('401 invalid_access_token termina la sesión como vencida', async () => {
      const outcome = await createWith(CREATE_TRAINING_PLAN_RESPONSES.invalidAccessToken);

      expect(outcome.kind).toBe('failed');
      expect(session.user()).toBeNull();
      expect(session.lastEndReason()).toBe('expired');
    });

    it('sin access token vigente no llama al BFF y termina la sesión', async () => {
      session.end();

      const outcome = await gateway.createPlan(DRAFT, KEY);

      expect(outcome).toEqual(
        jasmine.objectContaining({
          kind: 'failed',
          error: jasmine.objectContaining({ kind: 'unauthenticated' }),
        }),
      );
      expect(session.lastEndReason()).toBe('expired');
      http.expectNone(`${BFF}/v1/training-plans`);
    });
  });

  describe('getPlan', () => {
    it('CA4: consulta el plan con el token y lo transforma', async () => {
      const plan = gateway.getPlan(SIMULATED_PLAN_ID);
      const request = http.expectOne(`${BFF}/v1/training-plans/${SIMULATED_PLAN_ID}`);

      expect(request.request.method).toBe('GET');
      expect(request.request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
      request.flush(GET_TRAINING_PLAN_RESPONSES.found.body);

      expect((await plan).id).toBe(SIMULATED_PLAN_ID);
      expect((await plan).sessions[0].scheduledDate).toBe('2026-11-03');
    });

    it('rechaza con el error original si el plan no está disponible', async () => {
      const plan = gateway.getPlan(SIMULATED_PLAN_ID);
      const notFound = GET_TRAINING_PLAN_RESPONSES.trainingPlanNotFound;
      http
        .expectOne(`${BFF}/v1/training-plans/${SIMULATED_PLAN_ID}`)
        .flush(notFound.body, { status: 404, statusText: 'Not Found' });

      await expectAsync(plan).toBeRejectedWith(jasmine.any(HttpErrorResponse));
      expect(session.user()).not.toBeNull();
    });

    it('401 invalid_access_token termina la sesión', async () => {
      const plan = gateway.getPlan(SIMULATED_PLAN_ID);
      const rejected = GET_TRAINING_PLAN_RESPONSES.invalidAccessToken;
      http
        .expectOne(`${BFF}/v1/training-plans/${SIMULATED_PLAN_ID}`)
        .flush(rejected.body, { status: 401, statusText: 'Unauthorized' });

      await expectAsync(plan).toBeRejected();
      expect(session.lastEndReason()).toBe('expired');
    });
  });
});
