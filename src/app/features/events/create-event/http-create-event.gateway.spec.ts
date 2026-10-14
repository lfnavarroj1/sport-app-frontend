import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import {
  CREATE_EVENT_RESPONSES,
  CREATED_EVENT,
  SIMULATED_EVENT_CORRELATION_ID,
  SIMULATED_ORGANIZER_ID,
  VALID_CREATE_EVENT_REQUEST,
} from '../../../../testing/bff-web/create-event.fixtures';
import { SimulatedResponse } from '../../../../testing/bff-web/register-user.fixtures';
import { APP_CONFIG, AppConfig } from '../../../core/config/app-config';
import { SessionStore } from '../../../core/session/session.store';
import { CreateEventOutcome, EventDraft } from './create-event.model';
import { CREATE_EVENT_RETRY_DELAYS_MS, HttpCreateEventGateway } from './http-create-event.gateway';

const BFF = 'http://bff.example.com';
const URL = `${BFF}/v1/events`;
const KEY = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed';
const TOKEN = 'token-sintetico';

/** Borrador equivalente a la solicitud del ejemplo de ADR-028. */
const DRAFT: EventDraft = {
  name: VALID_CREATE_EVENT_REQUEST.name,
  description: VALID_CREATE_EVENT_REQUEST.description,
  discipline: VALID_CREATE_EVENT_REQUEST.discipline,
  location: {
    name: VALID_CREATE_EVENT_REQUEST.location.name,
    address: VALID_CREATE_EVENT_REQUEST.location.address,
    city: VALID_CREATE_EVENT_REQUEST.location.city,
    countryCode: 'CO',
  },
  startDate: '2026-11-15',
  startTime: '07:00',
  timeZone: 'America/Bogota',
  durationMinutes: 180,
  capacity: 5000,
};

describe('HttpCreateEventGateway (HU021, contrato bff-web 0.12.0)', () => {
  let http: HttpTestingController;
  let session: SessionStore;
  let gateway: HttpCreateEventGateway;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        HttpCreateEventGateway,
        { provide: CREATE_EVENT_RETRY_DELAYS_MS, useValue: [0, 0, 0] },
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
    gateway = TestBed.inject(HttpCreateEventGateway);
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

  /** Espera a que el adaptador emita la siguiente solicitud y la responde. */
  async function respond(response: SimulatedResponse, headers: Record<string, string> = {}) {
    let pending = http.match(URL);
    for (let tick = 0; pending.length === 0 && tick < 20; tick++) {
      await new Promise((resolve) => setTimeout(resolve));
      pending = http.match(URL);
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

  it('CA1: envía exactamente el cuerpo de ADR-028 con token y clave, y devuelve el borrador', async () => {
    const outcome = gateway.createEvent(DRAFT, KEY);
    const request = await respond(CREATE_EVENT_RESPONSES.created);

    expect(request.request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
    expect(request.request.headers.get('Idempotency-Key')).toBe(KEY);
    expect(request.request.body).toEqual(VALID_CREATE_EVENT_REQUEST);
    expect(await outcome).toEqual({
      kind: 'created',
      replayed: false,
      event: jasmine.objectContaining({
        id: CREATED_EVENT.event_id,
        status: 'DRAFT',
        version: 1,
        startsAt: '2026-11-15T12:00:00Z',
        endsAt: '2026-11-15T15:00:00Z',
        timeZone: 'America/Bogota',
        location: { ...DRAFT.location },
      }),
    });
  });

  it('CA4: reconoce el resultado de un reintento por Idempotent-Replayed', async () => {
    const outcome = gateway.createEvent(DRAFT, KEY);
    await respond(CREATE_EVENT_RESPONSES.created, { 'Idempotent-Replayed': 'true' });

    expect((await outcome) as CreateEventOutcome).toEqual(
      jasmine.objectContaining({ kind: 'created', replayed: true }),
    );
  });

  it('CA3: traduce validation_error a reglas por campo', async () => {
    const outcome = gateway.createEvent(DRAFT, KEY);
    await respond(CREATE_EVENT_RESPONSES.validationError);

    expect(await outcome).toEqual({
      kind: 'invalid',
      violations: [
        { field: 'starts_at', issue: 'not_in_future' },
        { field: 'time_zone', issue: 'time_zone_offset_mismatch' },
        { field: 'location.country_code', issue: 'unknown_value' },
        { field: 'capacity', issue: 'out_of_range' },
      ],
    });
  });

  it('CA2: el rechazo por permiso no se reintenta ni se presenta como éxito', async () => {
    const outcome = gateway.createEvent(DRAFT, KEY);
    await respond(CREATE_EVENT_RESPONSES.permissionRequired);

    expect(await outcome).toEqual({
      kind: 'failed',
      error: {
        kind: 'forbidden',
        status: 403,
        code: 'permission_required',
        correlationId: SIMULATED_EVENT_CORRELATION_ID,
      },
    });
  });

  it('CA4: idempotency_key_reused se informa sin reintentar', async () => {
    const outcome = gateway.createEvent(DRAFT, KEY);
    await respond(CREATE_EVENT_RESPONSES.idempotencyKeyReused);

    expect(await outcome).toEqual(
      jasmine.objectContaining({
        kind: 'failed',
        error: jasmine.objectContaining({ code: 'idempotency_key_reused' }),
      }),
    );
  });

  it('CA7: ante 503 o sin red reintenta con la misma clave y confirma el evento', async () => {
    const retries: number[] = [];
    const outcome = gateway.createEvent(DRAFT, KEY, (attempt) => retries.push(attempt));
    const first = await respond(CREATE_EVENT_RESPONSES.upstreamUnavailable);
    const second = await respond({ status: 0, body: null });
    const third = await respond(CREATE_EVENT_RESPONSES.created, { 'Idempotent-Replayed': 'true' });

    expect(retries).toEqual([1, 2]);
    expect(
      [first, second, third].map((request) => request.request.headers.get('Idempotency-Key')),
    ).toEqual([KEY, KEY, KEY]);
    expect((await outcome).kind).toBe('created');
  });

  it('CA7: reintenta como máximo tres veces y después falla de forma trazable', async () => {
    const outcome = gateway.createEvent(DRAFT, KEY);
    await respond(CREATE_EVENT_RESPONSES.upstreamTimeout);
    await respond(CREATE_EVENT_RESPONSES.upstreamUnavailable);
    await respond({ status: 502, body: { code: 'bad_gateway', message: 'simulado' } });
    await respond(CREATE_EVENT_RESPONSES.upstreamTimeout);

    expect(await outcome).toEqual(
      jasmine.objectContaining({
        kind: 'failed',
        error: jasmine.objectContaining({ kind: 'server', code: 'upstream_timeout' }),
      }),
    );
  });

  it('CA7: una respuesta 4xx no se repite automáticamente', async () => {
    const outcome = gateway.createEvent(DRAFT, KEY);
    await respond(CREATE_EVENT_RESPONSES.validationError);
    await outcome;

    await new Promise((resolve) => setTimeout(resolve));
    http.expectNone(URL);
  });

  it('401 invalid_access_token termina la sesión como vencida', async () => {
    const outcome = gateway.createEvent(DRAFT, KEY);
    await respond(CREATE_EVENT_RESPONSES.invalidAccessToken);

    expect((await outcome).kind).toBe('failed');
    expect(session.lastEndReason()).toBe('expired');
  });

  it('sin access token vigente no llama al BFF', async () => {
    session.end();

    expect((await gateway.createEvent(DRAFT, KEY)).kind).toBe('failed');
    expect(session.lastEndReason()).toBe('expired');
    http.expectNone(URL);
  });
});
