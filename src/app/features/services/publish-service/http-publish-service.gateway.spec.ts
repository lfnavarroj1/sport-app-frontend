import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { SIMULATED_SERVICE_PROVIDER_ID } from '../../../../testing/bff-web/create-service.fixtures';
import {
  MY_SERVICE_RESPONSES,
  MY_SERVICES_RESPONSES,
  PUBLISH_SERVICE_RESPONSES,
  SIMULATED_PUBLISH_SERVICE_CORRELATION_ID,
  SIMULATED_PUBLISH_SERVICE_ID,
} from '../../../../testing/bff-web/publish-service.fixtures';
import { SimulatedResponse } from '../../../../testing/bff-web/register-user.fixtures';
import { APP_CONFIG, AppConfig } from '../../../core/config/app-config';
import { SessionStore } from '../../../core/session/session.store';
import {
  HttpPublishServiceGateway,
  PUBLISH_SERVICE_RETRY_DELAYS_MS,
} from './http-publish-service.gateway';

const BFF = 'http://bff.example.com';
const LIST_URL = `${BFF}/v1/me/services`;
const DETAIL_URL = `${BFF}/v1/me/services/${SIMULATED_PUBLISH_SERVICE_ID}`;
const PUBLISH_URL = `${BFF}/v1/services/${SIMULATED_PUBLISH_SERVICE_ID}/publish`;
const KEY = '7f3c2a1e-4b5d-4e6f-8a9b-0c1d2e3f4a5c';
const TOKEN = 'token-sintetico';

describe('HttpPublishServiceGateway (HU019, contrato bff-web 0.16.0)', () => {
  let http: HttpTestingController;
  let session: SessionStore;
  let gateway: HttpPublishServiceGateway;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        HttpPublishServiceGateway,
        { provide: PUBLISH_SERVICE_RETRY_DELAYS_MS, useValue: [0, 0, 0] },
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
    gateway = TestBed.inject(HttpPublishServiceGateway);
    session.start({
      user: {
        id: SIMULATED_SERVICE_PROVIDER_ID,
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

  describe('consultas de los servicios propios', () => {
    it('pide los servicios propios por estado con el tamaño del contrato y los transforma', async () => {
      const page = gateway.loadServices('DRAFT', null);
      const request = await respond(LIST_URL, MY_SERVICES_RESPONSES.firstPage);

      expect(request.request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
      expect(request.request.params.keys().sort()).toEqual(['limit', 'status']);
      expect(request.request.params.get('status')).toBe('DRAFT');
      expect(request.request.params.get('limit')).toBe('20');
      const result = await page;
      expect(result.services.length).toBe(2);
      expect(result.services[0]).toEqual(
        jasmine.objectContaining({
          id: SIMULATED_PUBLISH_SERVICE_ID,
          status: 'DRAFT',
          version: 1,
          publishedAt: null,
          price: { amount: '120000.00', currency: 'COP', billingUnit: 'SESSION' },
        }),
      );
      expect(result.nextCursor).toBe('cursor-sintetico-servicios-2');
    });

    it('pide la página siguiente con el cursor sin modificar', async () => {
      const page = gateway.loadServices('PUBLISHED', 'cursor-sintetico-servicios-2');
      const request = await respond(LIST_URL, MY_SERVICES_RESPONSES.published);

      expect(request.request.params.get('cursor')).toBe('cursor-sintetico-servicios-2');
      expect(request.request.params.get('status')).toBe('PUBLISHED');
      expect((await page).services[0].publishedAt).toBe('2026-10-22T15:00:00Z');
    });

    it('un fallo de la lista llega como error, nunca como lista vacía', async () => {
      const page = gateway.loadServices('DRAFT', null);
      await respond(LIST_URL, MY_SERVICES_RESPONSES.upstreamUnavailable);

      await expectAsync(page).toBeRejectedWith(jasmine.any(HttpErrorResponse));
    });

    it('CA3: un servicio ajeno llega como 404 service_not_found', async () => {
      const detail = gateway.loadService(SIMULATED_PUBLISH_SERVICE_ID);
      await respond(DETAIL_URL, MY_SERVICE_RESPONSES.serviceNotFound);

      await expectAsync(detail).toBeRejectedWith(
        jasmine.objectContaining({
          status: 404,
          error: jasmine.objectContaining({ code: 'service_not_found' }),
        }),
      );
    });

    it('consulta el servicio propio completo', async () => {
      const detail = gateway.loadService(SIMULATED_PUBLISH_SERVICE_ID);
      const request = await respond(DETAIL_URL, MY_SERVICE_RESPONSES.draft);

      expect(request.request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
      expect((await detail).intervals.length).toBe(1);
    });

    it('401 invalid_access_token termina la sesión como vencida', async () => {
      const page = gateway.loadServices('DRAFT', null);
      await respond(LIST_URL, MY_SERVICES_RESPONSES.invalidAccessToken);

      await expectAsync(page).toBeRejected();
      expect(session.lastEndReason()).toBe('expired');
    });

    it('sin access token vigente no llama al BFF', async () => {
      session.end();

      await expectAsync(gateway.loadServices('DRAFT', null)).toBeRejected();
      http.expectNone(LIST_URL);
    });
  });

  describe('publicar', () => {
    it('CA1: publica sin cuerpo con token y clave, y devuelve lo que confirmó el backend', async () => {
      const outcome = gateway.publish(SIMULATED_PUBLISH_SERVICE_ID, KEY);
      const request = await respond(PUBLISH_URL, PUBLISH_SERVICE_RESPONSES.published);

      expect(request.request.method).toBe('POST');
      expect(request.request.body).toBeNull();
      expect(request.request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
      expect(request.request.headers.get('Idempotency-Key')).toBe(KEY);
      expect(await outcome).toEqual({
        kind: 'published',
        replayed: false,
        service: {
          id: SIMULATED_PUBLISH_SERVICE_ID,
          status: 'PUBLISHED',
          version: 2,
          publishedAt: '2026-10-22T15:00:00Z',
          updatedAt: '2026-10-22T15:00:00Z',
        },
      });
    });

    it('CA4: reconoce el resultado de un reintento por Idempotent-Replayed', async () => {
      const outcome = gateway.publish(SIMULATED_PUBLISH_SERVICE_ID, KEY);
      await respond(PUBLISH_URL, PUBLISH_SERVICE_RESPONSES.published, {
        'Idempotent-Replayed': 'true',
      });

      expect(await outcome).toEqual(
        jasmine.objectContaining({ kind: 'published', replayed: true }),
      );
    });

    it('CA2: traduce validation_error a requisitos faltantes', async () => {
      const outcome = gateway.publish(SIMULATED_PUBLISH_SERVICE_ID, KEY);
      await respond(PUBLISH_URL, PUBLISH_SERVICE_RESPONSES.requirementsMissing);

      expect(await outcome).toEqual({
        kind: 'invalid',
        violations: [
          { field: 'description', issue: 'invalid_length' },
          { field: 'price.amount', issue: 'out_of_range' },
          { field: 'availability', issue: 'required' },
        ],
      });
    });

    it('CA3: un servicio ajeno no se publica ni se reintenta', async () => {
      const outcome = gateway.publish(SIMULATED_PUBLISH_SERVICE_ID, KEY);
      await respond(PUBLISH_URL, PUBLISH_SERVICE_RESPONSES.serviceNotFound);

      expect(await outcome).toEqual({
        kind: 'failed',
        error: {
          kind: 'not_found',
          status: 404,
          code: 'service_not_found',
          correlationId: SIMULATED_PUBLISH_SERVICE_CORRELATION_ID,
        },
      });
      await new Promise((resolve) => setTimeout(resolve));
      http.expectNone(PUBLISH_URL);
    });

    it('CA4: idempotency_key_reused se informa sin reintentar', async () => {
      const outcome = gateway.publish(SIMULATED_PUBLISH_SERVICE_ID, KEY);
      await respond(PUBLISH_URL, PUBLISH_SERVICE_RESPONSES.idempotencyKeyReused);

      expect(await outcome).toEqual(
        jasmine.objectContaining({
          kind: 'failed',
          error: jasmine.objectContaining({ code: 'idempotency_key_reused' }),
        }),
      );
    });

    it('CA4: ante una respuesta perdida o 503 reintenta con la misma clave hasta confirmar', async () => {
      const retries: number[] = [];
      const outcome = gateway.publish(SIMULATED_PUBLISH_SERVICE_ID, KEY, (attempt) =>
        retries.push(attempt),
      );
      const first = await respond(PUBLISH_URL, { status: 0, body: null });
      const second = await respond(PUBLISH_URL, PUBLISH_SERVICE_RESPONSES.upstreamUnavailable);
      const third = await respond(PUBLISH_URL, PUBLISH_SERVICE_RESPONSES.published, {
        'Idempotent-Replayed': 'true',
      });

      expect(retries).toEqual([1, 2]);
      expect(
        [first, second, third].map((request) => request.request.headers.get('Idempotency-Key')),
      ).toEqual([KEY, KEY, KEY]);
      expect(await outcome).toEqual(
        jasmine.objectContaining({ kind: 'published', replayed: true }),
      );
    });

    it('reintenta como máximo tres veces y después falla de forma trazable', async () => {
      const outcome = gateway.publish(SIMULATED_PUBLISH_SERVICE_ID, KEY);
      await respond(PUBLISH_URL, PUBLISH_SERVICE_RESPONSES.upstreamTimeout);
      await respond(PUBLISH_URL, PUBLISH_SERVICE_RESPONSES.upstreamUnavailable);
      await respond(PUBLISH_URL, {
        status: 502,
        body: { code: 'bad_gateway', message: 'simulado' },
      });
      await respond(PUBLISH_URL, PUBLISH_SERVICE_RESPONSES.upstreamTimeout);

      expect(await outcome).toEqual(
        jasmine.objectContaining({
          kind: 'failed',
          error: jasmine.objectContaining({ kind: 'server', code: 'upstream_timeout' }),
        }),
      );
    });

    it('una respuesta 4xx no se repite automáticamente', async () => {
      const outcome = gateway.publish(SIMULATED_PUBLISH_SERVICE_ID, KEY);
      await respond(PUBLISH_URL, PUBLISH_SERVICE_RESPONSES.availabilityRequired);
      await outcome;

      await new Promise((resolve) => setTimeout(resolve));
      http.expectNone(PUBLISH_URL);
    });

    it('un 200 sin cuerpo no se presenta como éxito', async () => {
      const outcome = gateway.publish(SIMULATED_PUBLISH_SERVICE_ID, KEY);
      await respond(PUBLISH_URL, { status: 200, body: null });

      expect((await outcome).kind).toBe('failed');
    });

    it('401 invalid_access_token termina la sesión como vencida', async () => {
      const outcome = gateway.publish(SIMULATED_PUBLISH_SERVICE_ID, KEY);
      await respond(PUBLISH_URL, PUBLISH_SERVICE_RESPONSES.invalidAccessToken);

      expect((await outcome).kind).toBe('failed');
      expect(session.lastEndReason()).toBe('expired');
    });

    it('sin access token vigente no llama al BFF', async () => {
      session.end();

      expect((await gateway.publish(SIMULATED_PUBLISH_SERVICE_ID, KEY)).kind).toBe('failed');
      expect(session.lastEndReason()).toBe('expired');
      http.expectNone(PUBLISH_URL);
    });
  });
});
