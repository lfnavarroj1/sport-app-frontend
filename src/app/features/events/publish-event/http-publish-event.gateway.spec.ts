import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { SIMULATED_ORGANIZER_ID } from '../../../../testing/bff-web/create-event.fixtures';
import {
  EVENT_DETAIL_RESPONSES,
  MY_EVENTS_RESPONSES,
  PUBLISH_EVENT_RESPONSES,
  SIMULATED_PUBLISH_CORRELATION_ID,
  SIMULATED_PUBLISH_EVENT_ID,
  organizerEvent,
} from '../../../../testing/bff-web/publish-event.fixtures';
import { SimulatedResponse } from '../../../../testing/bff-web/register-user.fixtures';
import { APP_CONFIG, AppConfig } from '../../../core/config/app-config';
import { SessionStore } from '../../../core/session/session.store';
import {
  HttpPublishEventGateway,
  PUBLISH_EVENT_RETRY_DELAYS_MS,
} from './http-publish-event.gateway';

const BFF = 'http://bff.example.com';
const LIST_URL = `${BFF}/v1/me/events`;
const DETAIL_URL = `${BFF}/v1/events/${SIMULATED_PUBLISH_EVENT_ID}`;
const PUBLISH_URL = `${DETAIL_URL}/publish`;
const KEY = '7f3c2a1e-4b5d-4e6f-8a9b-0c1d2e3f4a5b';
const TOKEN = 'token-sintetico';

describe('HttpPublishEventGateway (HU024, contrato bff-web 0.16.0)', () => {
  let http: HttpTestingController;
  let session: SessionStore;
  let gateway: HttpPublishEventGateway;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        HttpPublishEventGateway,
        { provide: PUBLISH_EVENT_RETRY_DELAYS_MS, useValue: [0, 0, 0] },
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
    gateway = TestBed.inject(HttpPublishEventGateway);
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

  describe('consultas de apoyo', () => {
    it('CA6: pide los eventos propios por estado con el tamaño del contrato y los transforma', async () => {
      const page = gateway.loadEvents('DRAFT', null);
      const request = await respond(LIST_URL, MY_EVENTS_RESPONSES.firstPage);

      expect(request.request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
      expect(request.request.params.keys().sort()).toEqual(['limit', 'status']);
      expect(request.request.params.get('status')).toBe('DRAFT');
      expect(request.request.params.get('limit')).toBe('20');
      const result = await page;
      const first = organizerEvent(0);
      expect(result.events[0]).toEqual({
        id: first.event_id,
        name: first.name,
        discipline: first.discipline,
        location: {
          name: first.location.name,
          address: first.location.address,
          city: first.location.city,
          countryCode: first.location.country_code,
        },
        startsAt: first.starts_at,
        endsAt: first.ends_at,
        timeZone: first.time_zone,
        durationMinutes: first.duration_minutes,
        capacity: first.capacity,
        status: 'DRAFT',
        version: 1,
        publishedAt: null,
      });
      expect(result.nextCursor).toBe('cursor-sintetico-eventos-2');
    });

    it('pide la página siguiente con el cursor sin modificar', async () => {
      const page = gateway.loadEvents('PUBLISHED', 'cursor-sintetico-eventos-2');
      const request = await respond(LIST_URL, MY_EVENTS_RESPONSES.published);

      expect(request.request.params.get('cursor')).toBe('cursor-sintetico-eventos-2');
      expect(request.request.params.get('status')).toBe('PUBLISHED');
      expect((await page).events[0].publishedAt).toBe('2026-10-12T23:10:00Z');
    });

    it('un fallo de la lista llega como error, nunca como lista vacía', async () => {
      const page = gateway.loadEvents('DRAFT', null);
      await respond(LIST_URL, MY_EVENTS_RESPONSES.upstreamUnavailable);

      await expectAsync(page).toBeRejectedWith(jasmine.any(HttpErrorResponse));
    });

    it('consulta el detalle y lo transforma (sin dirección ni duración)', async () => {
      const detail = gateway.loadEvent(SIMULATED_PUBLISH_EVENT_ID);
      const request = await respond(DETAIL_URL, EVENT_DETAIL_RESPONSES.draft);

      expect(request.request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
      expect(await detail).toEqual(
        jasmine.objectContaining({
          id: SIMULATED_PUBLISH_EVENT_ID,
          status: 'DRAFT',
          location: {
            name: 'Parque Metropolitano Simón Bolívar',
            city: 'Bogotá',
            countryCode: 'CO',
          },
        }),
      );
    });

    it('CA3: el 404 del detalle llega como error', async () => {
      const detail = gateway.loadEvent(SIMULATED_PUBLISH_EVENT_ID);
      await respond(DETAIL_URL, EVENT_DETAIL_RESPONSES.eventNotFound);

      await expectAsync(detail).toBeRejectedWith(jasmine.any(HttpErrorResponse));
    });

    it('401 invalid_access_token termina la sesión como vencida', async () => {
      const page = gateway.loadEvents('DRAFT', null);
      await respond(LIST_URL, MY_EVENTS_RESPONSES.invalidAccessToken);

      await expectAsync(page).toBeRejected();
      expect(session.lastEndReason()).toBe('expired');
    });

    it('sin access token vigente no llama al BFF', async () => {
      session.end();

      await expectAsync(gateway.loadEvents('DRAFT', null)).toBeRejected();
      await expectAsync(gateway.loadEvent(SIMULATED_PUBLISH_EVENT_ID)).toBeRejected();
      http.expectNone(() => true);
    });
  });

  describe('publicar', () => {
    it('CA1: publica sin cuerpo con token y clave, y devuelve el agregado confirmado', async () => {
      const outcome = gateway.publish(SIMULATED_PUBLISH_EVENT_ID, KEY);
      const request = await respond(PUBLISH_URL, PUBLISH_EVENT_RESPONSES.published);

      expect(request.request.method).toBe('POST');
      expect(request.request.body).toBeNull();
      expect(request.request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
      expect(request.request.headers.get('Idempotency-Key')).toBe(KEY);
      expect(await outcome).toEqual({
        kind: 'published',
        replayed: false,
        event: jasmine.objectContaining({
          id: SIMULATED_PUBLISH_EVENT_ID,
          status: 'PUBLISHED',
          version: 2,
          publishedAt: '2026-10-18T15:00:00Z',
        }),
      });
    });

    it('CA4: informa Idempotent-Replayed', async () => {
      const outcome = gateway.publish(SIMULATED_PUBLISH_EVENT_ID, KEY);
      await respond(PUBLISH_URL, PUBLISH_EVENT_RESPONSES.published, {
        'Idempotent-Replayed': 'true',
      });

      expect(await outcome).toEqual(
        jasmine.objectContaining({ kind: 'published', replayed: true }),
      );
    });

    it('CA2: un 422 se traduce a los requisitos faltantes', async () => {
      const outcome = gateway.publish(SIMULATED_PUBLISH_EVENT_ID, KEY);
      await respond(PUBLISH_URL, PUBLISH_EVENT_RESPONSES.requirementsMissing);

      expect(await outcome).toEqual({
        kind: 'invalid',
        violations: [
          { field: 'description', issue: 'invalid_length' },
          { field: 'location.city', issue: 'required' },
        ],
      });
    });

    it('reintenta ante red, 502, 503 y 504 con la misma clave', async () => {
      const retries: number[] = [];
      const outcome = gateway.publish(SIMULATED_PUBLISH_EVENT_ID, KEY, (attempt) =>
        retries.push(attempt),
      );
      const first = await respond(PUBLISH_URL, PUBLISH_EVENT_RESPONSES.upstreamUnavailable);
      const second = await respond(PUBLISH_URL, { status: 0, body: null });
      const third = await respond(PUBLISH_URL, PUBLISH_EVENT_RESPONSES.published, {
        'Idempotent-Replayed': 'true',
      });

      for (const request of [first, second, third]) {
        expect(request.request.headers.get('Idempotency-Key')).toBe(KEY);
      }
      expect(retries).toEqual([1, 2]);
      expect((await outcome).kind).toBe('published');
    });

    it('agotados tres reintentos, informa el fallo con su referencia', async () => {
      const outcome = gateway.publish(SIMULATED_PUBLISH_EVENT_ID, KEY);
      await respond(PUBLISH_URL, PUBLISH_EVENT_RESPONSES.upstreamTimeout);
      await respond(PUBLISH_URL, PUBLISH_EVENT_RESPONSES.upstreamUnavailable);
      await respond(PUBLISH_URL, {
        status: 502,
        body: { code: 'bad_gateway', message: 'simulado' },
      });
      await respond(PUBLISH_URL, PUBLISH_EVENT_RESPONSES.upstreamTimeout);

      expect(await outcome).toEqual({
        kind: 'failed',
        error: jasmine.objectContaining({
          kind: 'server',
          code: 'upstream_timeout',
          correlationId: SIMULATED_PUBLISH_CORRELATION_ID,
        }),
      });
    });

    for (const [name, code] of [
      ['eventNotFound', 'event_not_found'],
      ['permissionRequired', 'permission_required'],
      ['idempotencyKeyReused', 'idempotency_key_reused'],
    ] as const) {
      it(`un ${code} no se reintenta ni se presenta como éxito`, async () => {
        const outcome = gateway.publish(SIMULATED_PUBLISH_EVENT_ID, KEY);
        await respond(PUBLISH_URL, PUBLISH_EVENT_RESPONSES[name]);

        expect(await outcome).toEqual({
          kind: 'failed',
          error: jasmine.objectContaining({ code }),
        });
        http.expectNone(PUBLISH_URL);
      });
    }

    it('un 200 sin cuerpo no confirma la publicación', async () => {
      const outcome = gateway.publish(SIMULATED_PUBLISH_EVENT_ID, KEY);
      await respond(PUBLISH_URL, { status: 200, body: null });

      expect((await outcome).kind).toBe('failed');
    });

    it('401 invalid_access_token termina la sesión como vencida', async () => {
      const outcome = gateway.publish(SIMULATED_PUBLISH_EVENT_ID, KEY);
      await respond(PUBLISH_URL, PUBLISH_EVENT_RESPONSES.invalidAccessToken);

      expect((await outcome).kind).toBe('failed');
      expect(session.lastEndReason()).toBe('expired');
    });

    it('sin access token vigente no llama al BFF', async () => {
      session.end();

      expect((await gateway.publish(SIMULATED_PUBLISH_EVENT_ID, KEY)).kind).toBe('failed');
      http.expectNone(PUBLISH_URL);
    });
  });
});
