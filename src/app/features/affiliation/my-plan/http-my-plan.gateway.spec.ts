import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import {
  MY_SUBSCRIPTION_RESPONSES,
  PLANS_RESPONSES,
  SUBSCRIPTION_CHANGE_RESPONSES,
  VALID_SUBSCRIPTION_CHANGE_REQUEST,
} from '../../../../testing/bff-web/affiliation.fixtures';
import { SimulatedResponse } from '../../../../testing/bff-web/register-user.fixtures';
import { APP_CONFIG, AppConfig } from '../../../core/config/app-config';
import { SessionStore } from '../../../core/session/session.store';
import { HttpMyPlanGateway, SUBSCRIPTION_CHANGE_RETRY_DELAYS_MS } from './http-my-plan.gateway';
import { PlanChoice } from './my-plan.model';

const BFF = 'http://bff.example.com';
const PLANS_URL = `${BFF}/v1/plans`;
const SUBSCRIPTION_URL = `${BFF}/v1/me/subscription`;
const CHANGES_URL = `${BFF}/v1/me/subscription/changes`;
const KEY = '2c4e6a8b-1d3f-4a5c-9e7b-0d2f4a6c8e1b';
const TOKEN = 'token-sintetico';
const CHOICE: PlanChoice = { planCode: 'PREMIUM', periodicity: 'QUARTERLY', expectedVersion: 1 };

describe('HttpMyPlanGateway (HU016, contrato bff-web 0.20.0)', () => {
  let http: HttpTestingController;
  let session: SessionStore;
  let gateway: HttpMyPlanGateway;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        HttpMyPlanGateway,
        { provide: SUBSCRIPTION_CHANGE_RETRY_DELAYS_MS, useValue: [0, 0, 0] },
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
    gateway = TestBed.inject(HttpMyPlanGateway);
    session.start({
      user: {
        id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
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

  /** Espera a que el adaptador emita la siguiente solicitud a `url` y la responde. */
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
    const request = pending[0];
    if (response.status === 0) {
      request.error(new ProgressEvent('error'));
    } else {
      request.flush(response.body as object, {
        status: response.status,
        statusText: 'simulado',
        headers,
      });
    }
    return request;
  }

  describe('consulta', () => {
    it('CA7: pide catálogo y suscripción con el token y los transforma', async () => {
      const loaded = gateway.load();
      const plans = await respond(PLANS_URL, PLANS_RESPONSES.free);
      const subscription = await respond(SUBSCRIPTION_URL, MY_SUBSCRIPTION_RESPONSES.free);

      expect(plans.request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
      expect(subscription.request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
      const result = await loaded;
      expect(result.catalog.currentPlanCode).toBe('FREE');
      expect(result.catalog.plans.map((plan) => plan.code)).toEqual([
        'FREE',
        'INTERMEDIATE',
        'PREMIUM',
      ]);
      expect(result.subscription).toEqual(
        jasmine.objectContaining({ status: 'ACTIVE', planCode: 'FREE', version: 1 }),
      );
    });

    it('un fallo llega como error, nunca como plan gratuito', async () => {
      const loaded = gateway.load();
      await respond(PLANS_URL, PLANS_RESPONSES.free);
      await respond(SUBSCRIPTION_URL, MY_SUBSCRIPTION_RESPONSES.upstreamUnavailable);

      await expectAsync(loaded).toBeRejectedWith(jasmine.any(HttpErrorResponse));
    });

    it('401 invalid_access_token termina la sesión como vencida', async () => {
      const loaded = gateway.load();
      await respond(PLANS_URL, PLANS_RESPONSES.invalidAccessToken);
      await respond(SUBSCRIPTION_URL, MY_SUBSCRIPTION_RESPONSES.invalidAccessToken);

      await expectAsync(loaded).toBeRejected();
      expect(session.lastEndReason()).toBe('expired');
    });

    it('sin access token vigente no llama al BFF', async () => {
      session.end();

      await expectAsync(gateway.load()).toBeRejected();
      http.expectNone(PLANS_URL);
    });
  });

  describe('cambiar el plan', () => {
    it('CA1: envía plan, periodicidad y versión con la clave, y devuelve lo confirmado', async () => {
      const outcome = gateway.change(CHOICE, KEY);
      const request = await respond(CHANGES_URL, SUBSCRIPTION_CHANGE_RESPONSES.changed);

      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual(VALID_SUBSCRIPTION_CHANGE_REQUEST);
      expect(request.request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
      expect(request.request.headers.get('Idempotency-Key')).toBe(KEY);
      expect(await outcome).toEqual({
        kind: 'changed',
        replayed: false,
        subscription: jasmine.objectContaining({
          planCode: 'PREMIUM',
          periodicity: 'QUARTERLY',
          version: 2,
          periodEnd: '2027-01-24T15:00:00Z',
        }),
      });
    });

    it('CA3: reconoce la respuesta original de un reintento por Idempotent-Replayed', async () => {
      const outcome = gateway.change(CHOICE, KEY);
      await respond(CHANGES_URL, SUBSCRIPTION_CHANGE_RESPONSES.changed, {
        'Idempotent-Replayed': 'true',
      });

      expect(await outcome).toEqual(jasmine.objectContaining({ kind: 'changed', replayed: true }));
    });

    it('reintenta red, 502, 503 y 504 con la misma clave, hasta tres veces', async () => {
      const retries: number[] = [];
      const outcome = gateway.change(CHOICE, KEY, (attempt) => retries.push(attempt));
      const keys: (string | null)[] = [];
      for (const response of [
        { status: 0, body: null },
        { status: 502, body: { code: 'bad_gateway' } },
        SUBSCRIPTION_CHANGE_RESPONSES.upstreamTimeout,
      ] as SimulatedResponse[]) {
        keys.push((await respond(CHANGES_URL, response)).request.headers.get('Idempotency-Key'));
      }
      const last = await respond(CHANGES_URL, SUBSCRIPTION_CHANGE_RESPONSES.changed);
      keys.push(last.request.headers.get('Idempotency-Key'));

      expect(keys).toEqual([KEY, KEY, KEY, KEY]);
      expect(retries).toEqual([1, 2, 3]);
      expect((await outcome).kind).toBe('changed');
    });

    it('agotados los reintentos, el fallo transitorio no es éxito', async () => {
      const outcome = gateway.change(CHOICE, KEY);
      for (let attempt = 0; attempt < 4; attempt++) {
        await respond(CHANGES_URL, SUBSCRIPTION_CHANGE_RESPONSES.upstreamUnavailable);
      }

      expect(await outcome).toEqual({
        kind: 'failed',
        error: jasmine.objectContaining({ kind: 'server', code: 'upstream_unavailable' }),
      });
    });

    for (const [name, response, code] of [
      ['CA4', SUBSCRIPTION_CHANGE_RESPONSES.versionConflict, 'version_conflict'],
      ['CA3', SUBSCRIPTION_CHANGE_RESPONSES.subscriptionUnchanged, 'subscription_unchanged'],
      [
        'PROVISIONING',
        SUBSCRIPTION_CHANGE_RESPONSES.subscriptionProvisioning,
        'subscription_provisioning',
      ],
      ['CA2', SUBSCRIPTION_CHANGE_RESPONSES.planNotSelectable, 'plan_not_selectable'],
      ['CA2', SUBSCRIPTION_CHANGE_RESPONSES.planNotFound, 'plan_not_found'],
    ] as const) {
      it(`${name}: ${response.status} ${code} se rechaza sin reintentar`, async () => {
        const outcome = gateway.change(CHOICE, KEY);
        await respond(CHANGES_URL, response);

        expect(await outcome).toEqual({
          kind: 'failed',
          error: jasmine.objectContaining({ status: response.status, code }),
        });
      });
    }

    it('CA2: un 422 de periodicidad incoherente devuelve el campo sin el prefijo body', async () => {
      const outcome = gateway.change(CHOICE, KEY);
      await respond(CHANGES_URL, SUBSCRIPTION_CHANGE_RESPONSES.inconsistentPeriodicity);

      expect(await outcome).toEqual({
        kind: 'invalid',
        violations: [{ field: 'periodicity', issue: 'inconsistent_values' }],
      });
    });

    it('401 invalid_access_token termina la sesión', async () => {
      const outcome = gateway.change(CHOICE, KEY);
      await respond(CHANGES_URL, SUBSCRIPTION_CHANGE_RESPONSES.invalidAccessToken);

      expect((await outcome).kind).toBe('failed');
      expect(session.lastEndReason()).toBe('expired');
    });

    it('un 422 sin detalles o con detalles sin campo no se pierde', async () => {
      const outcome = gateway.change(CHOICE, KEY);
      await respond(CHANGES_URL, {
        status: 422,
        body: {
          code: 'validation_error',
          message: 'simulado',
          correlation_id: 'ref-sintetica-16',
          details: [{ field: null, issue: 'invalid' }],
        },
      });

      expect(await outcome).toEqual({
        kind: 'invalid',
        violations: [{ field: '', issue: 'invalid' }],
      });
      const bare = gateway.change(CHOICE, KEY);
      await respond(CHANGES_URL, { status: 422, body: { code: 'validation_error' } });
      expect(await bare).toEqual({ kind: 'invalid', violations: [] });
    });

    it('sin access token vigente no envía el cambio y termina la sesión', async () => {
      session.end();

      expect(await gateway.change(CHOICE, KEY)).toEqual({
        kind: 'failed',
        error: jasmine.objectContaining({ kind: 'unauthenticated' }),
      });
      http.expectNone(CHANGES_URL);
    });

    it('un 200 sin cuerpo no se presenta como cambio confirmado', async () => {
      const outcome = gateway.change(CHOICE, KEY);
      await respond(CHANGES_URL, { status: 200, body: null });

      expect((await outcome).kind).toBe('failed');
    });
  });
});
