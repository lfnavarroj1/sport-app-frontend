import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import {
  CREATE_NUTRITION_PLAN_RESPONSES,
  FOOD_CATALOG_RESPONSES,
  GET_NUTRITION_PLAN_RESPONSES,
  MY_NUTRITION_PLANS_RESPONSES,
  SIMULATED_FOOD_CATALOG_ETAG,
  SIMULATED_NEXT_CURSOR,
  SIMULATED_NUTRITION_CORRELATION_ID,
  SIMULATED_NUTRITION_PLAN_ID,
  SIMULATED_NUTRITION_PROFESSIONAL_ID,
  VALID_CREATE_NUTRITION_PLAN_REQUEST,
} from '../../../../testing/bff-web/nutrition.fixtures';
import { SimulatedResponse } from '../../../../testing/bff-web/register-user.fixtures';
import { APP_CONFIG, AppConfig } from '../../../core/config/app-config';
import { SessionStore } from '../../../core/session/session.store';
import { FoodCatalogCache } from './food-catalog.cache';
import { HttpNutritionGateway } from './http-nutrition.gateway';
import { CreateNutritionPlanOutcome, NutritionPlanDraft } from './nutrition-plan.model';

const BFF = 'http://bff.example.com';
const KEY = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
const TOKEN = 'token-sintetico';

// Datos sintéticos de prueba: el mismo plan que el cuerpo válido del simulador.
const DRAFT: NutritionPlanDraft = {
  athleteEmail: 'deportista@example.com',
  title: 'Recuperación tras la carrera',
  objectives: ['Mejorar la recuperación muscular', 'Mantener la hidratación'],
  startDate: '2026-11-02',
  endDate: '2026-11-29',
  meals: [
    {
      mealType: 'BREAKFAST',
      items: [
        { foodCode: 'OATS', quantity: '60', unit: 'G' },
        { foodCode: 'PEANUT_BUTTER', quantity: '1.5', unit: 'TBSP' },
      ],
    },
    { mealType: 'HYDRATION', items: [{ foodCode: 'WATER', quantity: '500', unit: 'ML' }] },
  ],
};

describe('HttpNutritionGateway (HU014, contrato bff-web 0.18.0)', () => {
  let http: HttpTestingController;
  let session: SessionStore;
  let gateway: HttpNutritionGateway;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        HttpNutritionGateway,
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
    gateway = TestBed.inject(HttpNutritionGateway);
    session.start({
      user: {
        id: SIMULATED_NUTRITION_PROFESSIONAL_ID,
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

  function flush(url: string, response: SimulatedResponse, headers: Record<string, string> = {}) {
    http.expectOne(url).flush(response.body as object, {
      status: response.status,
      statusText: 'simulado',
      headers,
    });
  }

  async function createWith(
    response: SimulatedResponse,
    headers: Record<string, string> = {},
  ): Promise<CreateNutritionPlanOutcome> {
    const outcome = gateway.createPlan(DRAFT, KEY);
    flush(`${BFF}/v1/nutrition-plans`, response, headers);
    return outcome;
  }

  describe('catálogo de alimentos', () => {
    it('lo transforma y lo guarda en memoria con su ETag', async () => {
      const catalog = gateway.loadCatalog();
      const request = http.expectOne(`${BFF}/v1/food-catalog`);
      expect(request.request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
      expect(request.request.headers.has('If-None-Match')).toBeFalse();
      request.flush(FOOD_CATALOG_RESPONSES.ok.body, {
        headers: { ETag: SIMULATED_FOOD_CATALOG_ETAG },
      });

      const result = await catalog;
      expect(result.foods.length).toBe(FOOD_CATALOG_RESPONSES.ok.body.items.length);
      expect(TestBed.inject(FoodCatalogCache).etag).toBe(SIMULATED_FOOD_CATALOG_ETAG);
    });

    it('lo revalida con If-None-Match y ante un 304 conserva el que tenía', async () => {
      const first = gateway.loadCatalog();
      flush(`${BFF}/v1/food-catalog`, FOOD_CATALOG_RESPONSES.ok, {
        ETag: SIMULATED_FOOD_CATALOG_ETAG,
      });
      const cached = await first;

      const second = gateway.loadCatalog();
      const request = http.expectOne(`${BFF}/v1/food-catalog`);
      expect(request.request.headers.get('If-None-Match')).toBe(SIMULATED_FOOD_CATALOG_ETAG);
      request.flush(null, { status: 304, statusText: 'Not Modified' });

      expect(await second).toBe(cached);
    });

    it('sin ETag no lo guarda y lo vuelve a pedir completo', async () => {
      const first = gateway.loadCatalog();
      flush(`${BFF}/v1/food-catalog`, FOOD_CATALOG_RESPONSES.ok);
      await first;

      void gateway.loadCatalog().catch(() => undefined);
      const request = http.expectOne(`${BFF}/v1/food-catalog`);
      expect(request.request.headers.has('If-None-Match')).toBeFalse();
      request.flush(FOOD_CATALOG_RESPONSES.ok.body);
    });

    it('un fallo se rechaza con el error original, nunca como catálogo vacío', async () => {
      const catalog = gateway.loadCatalog();
      flush(`${BFF}/v1/food-catalog`, FOOD_CATALOG_RESPONSES.upstreamUnavailable);

      await expectAsync(catalog).toBeRejectedWith(jasmine.any(HttpErrorResponse));
    });

    it('un token rechazado termina la sesión', async () => {
      const catalog = gateway.loadCatalog();
      flush(`${BFF}/v1/food-catalog`, FOOD_CATALOG_RESPONSES.invalidAccessToken);

      await expectAsync(catalog).toBeRejected();
      expect(session.accessToken()).toBeNull();
    });
  });

  describe('crear un plan', () => {
    it('envía el cuerpo del contrato con el token y la Idempotency-Key (CA1)', async () => {
      const outcome = gateway.createPlan(DRAFT, KEY);
      const request = http.expectOne(`${BFF}/v1/nutrition-plans`);
      expect(request.request.method).toBe('POST');
      expect(request.request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
      expect(request.request.headers.get('Idempotency-Key')).toBe(KEY);
      expect(request.request.body).toEqual(VALID_CREATE_NUTRITION_PLAN_REQUEST);
      request.flush(CREATE_NUTRITION_PLAN_RESPONSES.created.body, {
        status: 201,
        statusText: 'Created',
      });

      const result = await outcome;
      expect(result.kind).toBe('created');
      if (result.kind === 'created') {
        expect(result.plan.status).toBe('ASSIGNED');
        expect(result.plan.version).toBe(1);
        expect(result.warnings).toEqual([]);
        expect(result.replayed).toBeFalse();
      }
    });

    it('conserva el aviso de hábitos ausentes (CA6) y el reintento idempotente', async () => {
      const result = await createWith(CREATE_NUTRITION_PLAN_RESPONSES.createdWithoutHabits, {
        'Idempotent-Replayed': 'true',
      });

      expect(result).toEqual(
        jasmine.objectContaining({
          kind: 'created',
          warnings: ['nutrition_habits_missing'],
          replayed: true,
        }),
      );
    });

    it('el bloqueo por alergia o restricción llega por ítem y sin el prefijo body. (CA2)', async () => {
      const result = await createWith(CREATE_NUTRITION_PLAN_RESPONSES.nutritionPlanInvalid);

      expect(result).toEqual({
        kind: 'invalid',
        violations: [
          { path: 'meals.0.items.1.food_code', issue: 'conflicts_with_allergy' },
          { path: 'meals.0.items.1.food_code', issue: 'conflicts_with_restriction' },
          { path: 'end_date', issue: 'period_too_long' },
        ],
      });
    });

    it('un validation_error con detalles también se marca en el formulario', async () => {
      const result = await createWith(CREATE_NUTRITION_PLAN_RESPONSES.validationError);

      expect(result).toEqual({
        kind: 'invalid',
        violations: [{ path: 'meals.0.items.0.quantity', issue: 'string_pattern_mismatch' }],
      });
    });

    it('el deportista sin autorización se distingue (CA3)', async () => {
      const result = await createWith(CREATE_NUTRITION_PLAN_RESPONSES.athleteAuthorizationRequired);

      expect(result).toEqual({ kind: 'athlete_not_authorized' });
    });

    it('sin permiso, con Usuarios caído o con la clave reutilizada falla de forma segura', async () => {
      const cases: [SimulatedResponse, string, string][] = [
        [CREATE_NUTRITION_PLAN_RESPONSES.permissionRequired, 'forbidden', 'permission_required'],
        [CREATE_NUTRITION_PLAN_RESPONSES.upstreamUnavailable, 'server', 'upstream_unavailable'],
        [CREATE_NUTRITION_PLAN_RESPONSES.upstreamTimeout, 'server', 'upstream_timeout'],
        [
          CREATE_NUTRITION_PLAN_RESPONSES.idempotencyKeyReused,
          'conflict',
          'idempotency_key_reused',
        ],
      ];
      for (const [response, kind, code] of cases) {
        expect(await createWith(response)).toEqual({
          kind: 'failed',
          error: {
            kind: kind as never,
            status: response.status,
            code,
            correlationId: SIMULATED_NUTRITION_CORRELATION_ID,
          },
        });
      }
    });

    it('sin conexión no se presenta como éxito', async () => {
      const outcome = gateway.createPlan(DRAFT, KEY);
      http.expectOne(`${BFF}/v1/nutrition-plans`).error(new ProgressEvent('error'));

      expect(await outcome).toEqual(
        jasmine.objectContaining({
          kind: 'failed',
          error: jasmine.objectContaining({ kind: 'offline' }),
        }),
      );
    });

    it('un 201 sin cuerpo no confirma ningún plan', async () => {
      const outcome = gateway.createPlan(DRAFT, KEY);
      http
        .expectOne(`${BFF}/v1/nutrition-plans`)
        .flush(null, { status: 201, statusText: 'Created' });

      expect((await outcome).kind).toBe('failed');
    });

    it('sin sesión no llama al BFF', async () => {
      session.end();

      expect((await gateway.createPlan(DRAFT, KEY)).kind).toBe('failed');
      http.expectNone(`${BFF}/v1/nutrition-plans`);
    });
  });

  describe('consultas', () => {
    it('consulta un plan por identificador', async () => {
      const plan = gateway.getPlan(SIMULATED_NUTRITION_PLAN_ID);
      flush(
        `${BFF}/v1/nutrition-plans/${SIMULATED_NUTRITION_PLAN_ID}`,
        GET_NUTRITION_PLAN_RESPONSES.found,
      );

      expect((await plan).id).toBe(SIMULATED_NUTRITION_PLAN_ID);
    });

    it('un plan ajeno o aún sin proyectar se rechaza con el 404 original (CA3)', async () => {
      const plan = gateway.getPlan(SIMULATED_NUTRITION_PLAN_ID);
      flush(
        `${BFF}/v1/nutrition-plans/${SIMULATED_NUTRITION_PLAN_ID}`,
        GET_NUTRITION_PLAN_RESPONSES.nutritionPlanNotFound,
      );

      await expectAsync(plan).toBeRejectedWith(jasmine.objectContaining({ status: 404 }));
    });

    it('pagina los planes propios con el cursor sin modificar', async () => {
      const first = gateway.loadMyPlans(null);
      flush(`${BFF}/v1/me/nutrition-plans`, MY_NUTRITION_PLANS_RESPONSES.firstPage);
      expect(await first).toEqual(jasmine.objectContaining({ nextCursor: SIMULATED_NEXT_CURSOR }));

      const next = gateway.loadMyPlans(SIMULATED_NEXT_CURSOR);
      const request = http.expectOne((r) => r.url === `${BFF}/v1/me/nutrition-plans`);
      expect(request.request.params.get('cursor')).toBe(SIMULATED_NEXT_CURSOR);
      request.flush(MY_NUTRITION_PLANS_RESPONSES.lastPage.body);

      const page = await next;
      expect(page.plans.map((plan) => plan.title)).toEqual(['Base de pretemporada']);
      expect(page.nextCursor).toBeNull();
    });

    it('un fallo de la lista se rechaza: nunca se interpreta como vacía', async () => {
      const page = gateway.loadMyPlans(null);
      flush(`${BFF}/v1/me/nutrition-plans`, MY_NUTRITION_PLANS_RESPONSES.permissionRequired);

      await expectAsync(page).toBeRejectedWith(jasmine.objectContaining({ status: 403 }));
    });
  });
});
