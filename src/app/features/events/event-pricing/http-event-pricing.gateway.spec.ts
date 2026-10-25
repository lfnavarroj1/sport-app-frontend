import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { SIMULATED_ORGANIZER_ID } from '../../../../testing/bff-web/create-event.fixtures';
import {
  DELETE_EVENT_FEE_RESPONSES,
  MY_PRICED_EVENTS_RESPONSES,
  PUBLISHED_WITH_REGISTRATIONS,
  PUT_EVENT_FEE_RESPONSES,
} from '../../../../testing/bff-web/event-pricing.fixtures';
import { SimulatedResponse } from '../../../../testing/bff-web/register-user.fixtures';
import { APP_CONFIG, AppConfig } from '../../../core/config/app-config';
import { SessionStore } from '../../../core/session/session.store';
import { EVENT_FEE_RETRY_DELAYS_MS, HttpEventPricingGateway } from './http-event-pricing.gateway';

const BFF = 'http://bff.example.com';
const LIST_URL = `${BFF}/v1/me/events`;
const EVENT_ID = PUBLISHED_WITH_REGISTRATIONS.event_id;
const FEE_URL = `${BFF}/v1/events/${EVENT_ID}/fee`;
const KEY = '5c2a1e7f-3b4d-4e6f-9a8b-1c0d2e3f4a5b';
const TOKEN = 'token-sintetico';

describe('HttpEventPricingGateway (HU025, contrato bff-web 0.26.0)', () => {
  let http: HttpTestingController;
  let session: SessionStore;
  let gateway: HttpEventPricingGateway;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        HttpEventPricingGateway,
        { provide: EVENT_FEE_RETRY_DELAYS_MS, useValue: [0, 0, 0] },
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
    gateway = TestBed.inject(HttpEventPricingGateway);
    session.start({
      user: {
        id: SIMULATED_ORGANIZER_ID,
        fullName: 'Organizador Sintético',
        email: 'organizador@example.com',
        actorType: 'organizer',
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

  describe('eventos propios', () => {
    it('recorre todas las páginas con el límite máximo y el cursor sin modificar', async () => {
      const events = gateway.loadOwnEvents();
      const first = await respond(LIST_URL, MY_PRICED_EVENTS_RESPONSES.firstPage);
      expect(first.request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
      expect(first.request.params.keys()).toEqual(['limit']);
      expect(first.request.params.get('limit')).toBe('100');

      const second = await respond(LIST_URL, MY_PRICED_EVENTS_RESPONSES.lastPage);
      expect(second.request.params.get('cursor')).toBe('cursor-sintetico-tarifas-2');

      const result = await events;
      expect(result.map((event) => event.id)).toEqual([
        MY_PRICED_EVENTS_RESPONSES.firstPage.body.items[0].event_id,
        EVENT_ID,
      ]);
      expect(result[1].registrationCount).toBe(3);
      expect(result[1].fee).toEqual({ amount: '85000.00', currency: 'COP' });
    });

    it('un fallo llega como error, nunca como lista vacía', async () => {
      const events = gateway.loadOwnEvents();
      await respond(LIST_URL, PUT_EVENT_FEE_RESPONSES.upstreamUnavailable);

      await expectAsync(events).toBeRejectedWith(jasmine.any(HttpErrorResponse));
    });

    it('un token rechazado termina la sesión', async () => {
      const events = gateway.loadOwnEvents();
      await respond(LIST_URL, PUT_EVENT_FEE_RESPONSES.invalidAccessToken);

      await expectAsync(events).toBeRejected();
      expect(session.accessToken()).toBeNull();
    });
  });

  describe('asignar la tarifa', () => {
    it('CA1: envía el cuerpo del contrato y devuelve el evento con la versión nueva', async () => {
      const outcome = gateway.setFee(EVENT_ID, '90000.50', 2, KEY);
      const request = await respond(FEE_URL, PUT_EVENT_FEE_RESPONSES.assigned);

      expect(request.request.method).toBe('PUT');
      expect(request.request.body).toEqual({
        amount: '90000.50',
        currency: 'COP',
        expected_version: 2,
      });
      expect(request.request.headers.get('Idempotency-Key')).toBe(KEY);
      const result = await outcome;
      expect(result.kind).toBe('updated');
      if (result.kind === 'updated') {
        expect(result.event.version).toBe(3);
        expect(result.event.fee).toEqual({ amount: '90000.50', currency: 'COP' });
        expect(result.event.registrationCount).toBe(3);
        expect(result.replayed).toBeFalse();
      }
    });

    it('CA5: la misma clave devuelve la respuesta original y se marca como repetida', async () => {
      const outcome = gateway.setFee(EVENT_ID, '90000.50', 2, KEY);
      await respond(FEE_URL, PUT_EVENT_FEE_RESPONSES.assigned, { 'Idempotent-Replayed': 'true' });

      expect(await outcome).toEqual(jasmine.objectContaining({ kind: 'updated', replayed: true }));
    });

    it('reintenta hasta tres veces con la misma clave ante red, 502, 503 o 504', async () => {
      const retries: number[] = [];
      const outcome = gateway.setFee(EVENT_ID, '90000.50', 2, KEY, (attempt) =>
        retries.push(attempt),
      );
      const keys = [
        await respond(FEE_URL, { status: 0, body: null }),
        await respond(FEE_URL, { status: 502, body: null }),
        await respond(FEE_URL, PUT_EVENT_FEE_RESPONSES.upstreamTimeout),
        await respond(FEE_URL, PUT_EVENT_FEE_RESPONSES.assigned),
      ].map((request) => request.request.headers.get('Idempotency-Key'));

      expect(keys).toEqual([KEY, KEY, KEY, KEY]);
      expect(retries).toEqual([1, 2, 3]);
      expect((await outcome).kind).toBe('updated');
    });

    it('agotados los reintentos devuelve un fallo recuperable con su referencia', async () => {
      const outcome = gateway.setFee(EVENT_ID, '90000.50', 2, KEY);
      for (let attempt = 0; attempt < 4; attempt++) {
        await respond(FEE_URL, PUT_EVENT_FEE_RESPONSES.upstreamUnavailable);
      }

      expect(await outcome).toEqual({
        kind: 'failed',
        error: jasmine.objectContaining({
          kind: 'server',
          status: 503,
          code: 'upstream_unavailable',
        }),
      });
    });

    it('CA2: un 422 se traduce en reglas incumplidas por campo, sin reintentar', async () => {
      const outcome = gateway.setFee(EVENT_ID, '100000000.00', 2, KEY);
      await respond(FEE_URL, PUT_EVENT_FEE_RESPONSES.outOfRange);

      expect(await outcome).toEqual({
        kind: 'invalid',
        violations: [{ field: 'amount', issue: 'out_of_range' }],
      });
    });

    it('CA3: version_conflict informa la versión vigente', async () => {
      const outcome = gateway.setFee(EVENT_ID, '90000.50', 2, KEY);
      await respond(FEE_URL, PUT_EVENT_FEE_RESPONSES.versionConflict);

      expect(await outcome).toEqual({ kind: 'conflict', currentVersion: 3 });
    });

    it('CA3: un 404 y la clave reutilizada son fallos, nunca éxito', async () => {
      const notFound = gateway.setFee(EVENT_ID, '90000.50', 2, KEY);
      await respond(FEE_URL, PUT_EVENT_FEE_RESPONSES.eventNotFound);
      expect(await notFound).toEqual({
        kind: 'failed',
        error: jasmine.objectContaining({ code: 'event_not_found' }),
      });

      const reused = gateway.setFee(EVENT_ID, '90000.50', 2, KEY);
      await respond(FEE_URL, PUT_EVENT_FEE_RESPONSES.idempotencyKeyReused);
      expect(await reused).toEqual({
        kind: 'failed',
        error: jasmine.objectContaining({ code: 'idempotency_key_reused' }),
      });
    });

    it('un 200 sin cuerpo no se presenta como éxito', async () => {
      const outcome = gateway.setFee(EVENT_ID, '90000.50', 2, KEY);
      await respond(FEE_URL, { status: 200, body: null });

      expect((await outcome).kind).toBe('failed');
    });

    it('sin token termina la sesión sin enviar nada', async () => {
      session.end();

      expect(await gateway.setFee(EVENT_ID, '90000.50', 2, KEY)).toEqual({
        kind: 'failed',
        error: jasmine.objectContaining({ kind: 'unauthenticated' }),
      });
    });
  });

  describe('retirar la tarifa', () => {
    it('envía DELETE con expected_version y la clave, y devuelve la tarifa en null', async () => {
      const outcome = gateway.removeFee(EVENT_ID, 2, KEY);
      const request = await respond(FEE_URL, DELETE_EVENT_FEE_RESPONSES.removed);

      expect(request.request.method).toBe('DELETE');
      expect(request.request.params.get('expected_version')).toBe('2');
      expect(request.request.headers.get('Idempotency-Key')).toBe(KEY);
      const result = await outcome;
      expect(result.kind).toBe('updated');
      if (result.kind === 'updated') {
        expect(result.event.fee).toBeNull();
        expect(result.event.version).toBe(3);
      }
    });

    it('CA2: el evento iniciado llega como regla incumplida', async () => {
      const outcome = gateway.removeFee(EVENT_ID, 2, KEY);
      await respond(FEE_URL, DELETE_EVENT_FEE_RESPONSES.eventAlreadyStarted);

      expect(await outcome).toEqual({
        kind: 'invalid',
        violations: [{ field: 'starts_at', issue: 'event_already_started' }],
      });
    });
  });
});
