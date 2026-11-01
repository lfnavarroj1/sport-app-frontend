import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { SimulatedResponse } from '../../../../../testing/bff-web/register-user.fixtures';
import {
  MY_ROUTINES_RESPONSES,
  PUBLISH_ROUTINE_RESPONSES,
  RETIRE_ROUTINE_RESPONSES,
  ROUTINES_NEXT_CURSOR,
  SIMULATED_ROUTINES_PROFESSIONAL_ID,
  VALID_PUBLISH_ROUTINE_REQUEST,
  professionalRoutine,
} from '../../../../../testing/bff-web/nutrition-routines.fixtures';
import { APP_CONFIG, AppConfig } from '../../../../core/config/app-config';
import { SessionStore } from '../../../../core/session/session.store';
import { HttpRoutinesGateway, PUBLISH_ROUTINE_RETRY_DELAYS_MS } from './http-routines.gateway';
import { RoutineDraft } from './routines.model';

const BFF = 'http://bff.example.com';
const ROUTINES_URL = `${BFF}/v1/nutrition-routine-templates`;
const MY_ROUTINES_URL = `${BFF}/v1/me/nutrition-routine-templates`;
const ROUTINE_ID = professionalRoutine(0).template_id;
const RETIRE_URL = `${BFF}/v1/nutrition-routine-templates/${ROUTINE_ID}/retire`;
const KEY = '6c8e0a2b-4d6f-4b8d-9f1b-3d5f7a9c1e3d';
const TOKEN = 'token-sintetico';

const DRAFT: RoutineDraft = {
  title: VALID_PUBLISH_ROUTINE_REQUEST.title,
  description: VALID_PUBLISH_ROUTINE_REQUEST.description,
  goal: 'PERFORMANCE',
  sport: 'running',
  dietaryPattern: 'VEGETARIAN',
  containsAllergens: ['MILK'],
  durationDays: 14,
  dailyMeals: VALID_PUBLISH_ROUTINE_REQUEST.daily_meals.map((meal) => ({
    meal: meal.meal,
    items: meal.items.map((item) => ({ foodCode: item.food_code, portions: item.portions })),
  })),
};

describe('HttpRoutinesGateway (HU030, contrato bff-web 0.34.0)', () => {
  let http: HttpTestingController;
  let session: SessionStore;
  let gateway: HttpRoutinesGateway;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        HttpRoutinesGateway,
        { provide: PUBLISH_ROUTINE_RETRY_DELAYS_MS, useValue: [0, 0, 0] },
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
    gateway = TestBed.inject(HttpRoutinesGateway);
    session.start({
      user: {
        id: SIMULATED_ROUTINES_PROFESSIONAL_ID,
        fullName: 'Profesional Sintética',
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

  async function respond(
    url: string,
    response: SimulatedResponse,
    headers: Record<string, string> = {},
  ) {
    let pending = http.match((request) => request.url === url);
    for (let tick = 0; pending.length === 0 && tick < 20; tick++) {
      await new Promise((resolve) => setTimeout(resolve));
      pending = http.match((request) => request.url === url);
    }
    expect(pending.length).withContext('solicitudes pendientes').toBe(1);
    if (response.status === 0) {
      pending[0].error(new ProgressEvent('error'));
    } else {
      pending[0].flush(response.body as object, {
        status: response.status,
        statusText: 'simulado',
        headers,
      });
    }
    return pending[0];
  }

  describe('lista', () => {
    it('pide la primera página con el tamaño del contrato y la transforma', async () => {
      const page = gateway.loadRoutines(null);
      const request = await respond(MY_ROUTINES_URL, MY_ROUTINES_RESPONSES.firstPage);

      expect(request.request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
      expect(request.request.params.keys()).toEqual(['limit']);
      expect(request.request.params.get('limit')).toBe('20');
      const result = await page;
      expect(result.routines.length).toBe(20);
      expect(result.nextCursor).toBe(ROUTINES_NEXT_CURSOR);
    });

    it('pide la página siguiente con el cursor sin modificar', async () => {
      const page = gateway.loadRoutines(ROUTINES_NEXT_CURSOR);
      const request = await respond(MY_ROUTINES_URL, MY_ROUTINES_RESPONSES.lastPage);

      expect(request.request.params.get('cursor')).toBe(ROUTINES_NEXT_CURSOR);
      expect((await page).routines[1].status).toBe('RETIRED');
    });

    it('un fallo llega como error, nunca como lista vacía; 401 termina la sesión', async () => {
      const page = gateway.loadRoutines(null);
      await respond(MY_ROUTINES_URL, MY_ROUTINES_RESPONSES.invalidAccessToken);

      await expectAsync(page).toBeRejectedWith(jasmine.any(HttpErrorResponse));
      expect(session.lastEndReason()).toBe('expired');
    });

    it('sin access token vigente no llama al BFF', async () => {
      session.end();

      await expectAsync(gateway.loadRoutines(null)).toBeRejected();
      http.expectNone(MY_ROUTINES_URL);
    });
  });

  describe('publicar', () => {
    it('CA4: publica con token, clave y el cuerpo del contrato; devuelve lo confirmado', async () => {
      const outcome = gateway.publish(DRAFT, KEY);
      const request = await respond(ROUTINES_URL, PUBLISH_ROUTINE_RESPONSES.published);

      expect(request.request.method).toBe('POST');
      expect(request.request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
      expect(request.request.headers.get('Idempotency-Key')).toBe(KEY);
      expect(request.request.body).toEqual(VALID_PUBLISH_ROUTINE_REQUEST);
      expect(await outcome).toEqual({
        kind: 'published',
        replayed: false,
        routine: jasmine.objectContaining({ id: ROUTINE_ID, status: 'PUBLISHED', version: 1 }),
      });
    });

    it('CA4: reconoce el resultado de un reintento por Idempotent-Replayed', async () => {
      const outcome = gateway.publish(DRAFT, KEY);
      await respond(ROUTINES_URL, PUBLISH_ROUTINE_RESPONSES.published, {
        'Idempotent-Replayed': 'true',
      });

      expect(await outcome).toEqual(jasmine.objectContaining({ replayed: true }));
    });

    it('reintenta red, 502, 503 y 504 con la misma clave, hasta tres veces', async () => {
      const retries: number[] = [];
      const outcome = gateway.publish(DRAFT, KEY, (attempt) => retries.push(attempt));
      const keys: (string | null)[] = [];
      for (const response of [
        { status: 0, body: null },
        { status: 502, body: { code: 'bad_gateway' } },
        PUBLISH_ROUTINE_RESPONSES.upstreamTimeout,
        PUBLISH_ROUTINE_RESPONSES.published,
      ] as SimulatedResponse[]) {
        keys.push((await respond(ROUTINES_URL, response)).request.headers.get('Idempotency-Key'));
      }

      expect(keys).toEqual([KEY, KEY, KEY, KEY]);
      expect(retries).toEqual([1, 2, 3]);
      expect((await outcome).kind).toBe('published');
    });

    it('agotados los reintentos, el fallo transitorio no es éxito', async () => {
      const outcome = gateway.publish(DRAFT, KEY);
      for (let attempt = 0; attempt < 4; attempt++) {
        await respond(ROUTINES_URL, PUBLISH_ROUTINE_RESPONSES.upstreamUnavailable);
      }

      expect(await outcome).toEqual({
        kind: 'failed',
        error: jasmine.objectContaining({ kind: 'server', code: 'upstream_unavailable' }),
      });
    });

    it('CA4: traduce validation_error sin el prefijo body y con la posición de comidas y alimentos', async () => {
      const outcome = gateway.publish(DRAFT, KEY);
      await respond(ROUTINES_URL, PUBLISH_ROUTINE_RESPONSES.validationError);

      expect(await outcome).toEqual({
        kind: 'invalid',
        violations: [
          { field: 'title', issue: 'invalid_length' },
          { field: 'contains_allergens', issue: 'duplicate_value' },
          { field: 'daily_meals.0.items.1.food_code', issue: 'unknown_value' },
          { field: 'daily_meals.1.items.0.food_code', issue: 'conflicts_with_restriction' },
          { field: 'daily_meals.1.items.0.portions', issue: 'less_than_equal' },
        ],
      });
    });

    it('un 422 sin detalles o con detalles sin campo no se pierde', async () => {
      const bare = gateway.publish(DRAFT, KEY);
      await respond(ROUTINES_URL, { status: 422, body: { code: 'validation_error' } });
      expect(await bare).toEqual({ kind: 'invalid', violations: [] });

      const unnamed = gateway.publish(DRAFT, KEY);
      await respond(ROUTINES_URL, {
        status: 422,
        body: {
          code: 'validation_error',
          message: 'x',
          correlation_id: 'y',
          details: [{ field: null, issue: 'required' }],
        },
      });
      expect(await unnamed).toEqual({
        kind: 'invalid',
        violations: [{ field: '', issue: 'required' }],
      });
    });

    it('idempotency_key_reused y el permiso denegado se informan sin reintentar', async () => {
      for (const response of [
        PUBLISH_ROUTINE_RESPONSES.idempotencyKeyReused,
        PUBLISH_ROUTINE_RESPONSES.permissionRequired,
      ]) {
        const outcome = gateway.publish(DRAFT, KEY);
        await respond(ROUTINES_URL, response);
        expect(await outcome).toEqual({
          kind: 'failed',
          error: jasmine.objectContaining({ code: response.body.code }),
        });
      }
    });

    it('401 termina la sesión y un 201 sin cuerpo no es éxito', async () => {
      const unauthorized = gateway.publish(DRAFT, KEY);
      await respond(ROUTINES_URL, PUBLISH_ROUTINE_RESPONSES.invalidAccessToken);
      expect((await unauthorized).kind).toBe('failed');
      expect(session.lastEndReason()).toBe('expired');

      session.start({
        user: {
          id: SIMULATED_ROUTINES_PROFESSIONAL_ID,
          fullName: 'Profesional Sintética',
          email: 'profesional@example.com',
          actorType: 'service_provider',
        },
        accessToken: TOKEN,
        expiresAt: Date.now() + 600_000,
      });
      const empty = gateway.publish(DRAFT, KEY);
      await respond(ROUTINES_URL, { status: 201, body: null });
      expect((await empty).kind).toBe('failed');
    });

    it('sin access token vigente no publica', async () => {
      session.end();

      expect(await gateway.publish(DRAFT, KEY)).toEqual({
        kind: 'failed',
        error: jasmine.objectContaining({ kind: 'unauthenticated' }),
      });
      http.expectNone(ROUTINES_URL);
    });
  });

  describe('retirar', () => {
    it('CA4: retira con la versión mostrada y devuelve la rutina RETIRED', async () => {
      const outcome = gateway.retire(ROUTINE_ID, 1);
      const request = await respond(RETIRE_URL, RETIRE_ROUTINE_RESPONSES.retired);

      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({ expected_version: 1 });
      expect(request.request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
      expect(await outcome).toEqual({
        kind: 'retired',
        routine: jasmine.objectContaining({ status: 'RETIRED', version: 2 }),
      });
    });

    it('409 version_conflict informa la versión vigente sin retirar', async () => {
      const outcome = gateway.retire(ROUTINE_ID, 1);
      await respond(RETIRE_URL, RETIRE_ROUTINE_RESPONSES.versionConflict);

      expect(await outcome).toEqual({ kind: 'conflict', currentVersion: 2 });
    });

    it('CA4: una rutina ajena responde 404 template_not_found, nunca éxito', async () => {
      const outcome = gateway.retire(ROUTINE_ID, 1);
      await respond(RETIRE_URL, RETIRE_ROUTINE_RESPONSES.templateNotFound);

      expect(await outcome).toEqual({
        kind: 'failed',
        error: jasmine.objectContaining({ status: 404, code: 'template_not_found' }),
      });
    });

    it('un conflicto sin detalles tampoco inventa la versión vigente', async () => {
      const outcome = gateway.retire(ROUTINE_ID, 1);
      await respond(RETIRE_URL, { status: 409, body: { code: 'version_conflict' } });

      expect(await outcome).toEqual({ kind: 'conflict', currentVersion: null });
    });

    it('un conflicto sin versión vigente legible no inventa una', async () => {
      const outcome = gateway.retire(ROUTINE_ID, 1);
      await respond(RETIRE_URL, {
        status: 409,
        body: { code: 'version_conflict', message: 'x', correlation_id: 'y', details: [] },
      });

      expect(await outcome).toEqual({ kind: 'conflict', currentVersion: null });
    });

    it('sin access token vigente no retira; 401 termina la sesión', async () => {
      const outcome = gateway.retire(ROUTINE_ID, 1);
      await respond(RETIRE_URL, RETIRE_ROUTINE_RESPONSES.invalidAccessToken);
      expect((await outcome).kind).toBe('failed');
      expect(session.lastEndReason()).toBe('expired');

      expect((await gateway.retire(ROUTINE_ID, 1)).kind).toBe('failed');
      http.expectNone(RETIRE_URL);
    });
  });
});
