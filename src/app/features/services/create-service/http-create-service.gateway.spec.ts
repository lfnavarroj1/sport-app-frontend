import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import {
  CREATE_SERVICE_RESPONSES,
  CREATED_SERVICE,
  SIMULATED_SERVICE_CORRELATION_ID,
  SIMULATED_SERVICE_PROVIDER_ID,
  VALID_CREATE_SERVICE_REQUEST,
} from '../../../../testing/bff-web/create-service.fixtures';
import { SimulatedResponse } from '../../../../testing/bff-web/register-user.fixtures';
import { APP_CONFIG, AppConfig } from '../../../core/config/app-config';
import { SessionStore } from '../../../core/session/session.store';
import { CreateServiceOutcome, ServiceDraft } from './create-service.model';
import {
  CREATE_SERVICE_RETRY_DELAYS_MS,
  HttpCreateServiceGateway,
} from './http-create-service.gateway';

const BFF = 'http://bff.example.com';
const URL = `${BFF}/v1/services`;
const KEY = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed';
const TOKEN = 'token-sintetico';

/** Borrador equivalente a la solicitud del ejemplo de ADR-027. */
const DRAFT: ServiceDraft = {
  name: VALID_CREATE_SERVICE_REQUEST.name,
  description: VALID_CREATE_SERVICE_REQUEST.description,
  category: 'SPORTS_MEDICINE',
  modality: 'IN_PERSON',
  amount: '120000.00',
  billingUnit: 'SESSION',
  intervals: [
    {
      startDate: '2026-11-20',
      startTime: '09:00',
      endDate: '2026-11-20',
      endTime: '10:00',
      timeZone: 'America/Bogota',
      capacity: 1,
    },
  ],
};

describe('HttpCreateServiceGateway (HU015, contrato bff-web 0.16.0)', () => {
  let http: HttpTestingController;
  let session: SessionStore;
  let gateway: HttpCreateServiceGateway;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        HttpCreateServiceGateway,
        { provide: CREATE_SERVICE_RETRY_DELAYS_MS, useValue: [0, 0, 0] },
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
    gateway = TestBed.inject(HttpCreateServiceGateway);
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

  it('CA1: envía exactamente el cuerpo de ADR-027 con token y clave, y devuelve el borrador', async () => {
    const outcome = gateway.createService(DRAFT, KEY);
    const request = await respond(CREATE_SERVICE_RESPONSES.created);

    expect(request.request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
    expect(request.request.headers.get('Idempotency-Key')).toBe(KEY);
    expect(request.request.body).toEqual(VALID_CREATE_SERVICE_REQUEST);
    expect(await outcome).toEqual({
      kind: 'created',
      replayed: false,
      service: jasmine.objectContaining({
        id: CREATED_SERVICE.service_id,
        status: 'DRAFT',
        version: 1,
        intervals: [
          {
            startsAt: '2026-11-20T14:00:00Z',
            endsAt: '2026-11-20T15:00:00Z',
            timeZone: 'America/Bogota',
            capacity: 1,
          },
        ],
      }),
    });
  });

  it('CA4: reconoce el resultado de un reintento por Idempotent-Replayed', async () => {
    const outcome = gateway.createService(DRAFT, KEY);
    await respond(CREATE_SERVICE_RESPONSES.created, { 'Idempotent-Replayed': 'true' });

    expect((await outcome) as CreateServiceOutcome).toEqual(
      jasmine.objectContaining({ kind: 'created', replayed: true }),
    );
  });

  it('CA3 y CA6: traduce validation_error a reglas por campo, con el índice del intervalo', async () => {
    const outcome = gateway.createService(DRAFT, KEY);
    await respond(CREATE_SERVICE_RESPONSES.validationError);

    expect(await outcome).toEqual({
      kind: 'invalid',
      violations: [
        { field: 'price.amount', issue: 'too_many_decimals' },
        { field: 'availability[0].time_zone', issue: 'time_zone_offset_mismatch' },
        { field: 'availability[1].starts_at', issue: 'overlapping_interval' },
        { field: 'availability[1].ends_at', issue: 'out_of_range' },
      ],
    });
  });

  it('CA2: el rechazo por permiso no se reintenta ni se presenta como éxito', async () => {
    const outcome = gateway.createService(DRAFT, KEY);
    await respond(CREATE_SERVICE_RESPONSES.permissionRequired);

    expect(await outcome).toEqual({
      kind: 'failed',
      error: {
        kind: 'forbidden',
        status: 403,
        code: 'permission_required',
        correlationId: SIMULATED_SERVICE_CORRELATION_ID,
      },
    });
  });

  it('CA4: idempotency_key_reused se informa sin reintentar', async () => {
    const outcome = gateway.createService(DRAFT, KEY);
    await respond(CREATE_SERVICE_RESPONSES.idempotencyKeyReused);

    expect(await outcome).toEqual(
      jasmine.objectContaining({
        kind: 'failed',
        error: jasmine.objectContaining({ code: 'idempotency_key_reused' }),
      }),
    );
  });

  it('CA4: ante 503 o sin red reintenta con la misma clave y confirma el servicio', async () => {
    const retries: number[] = [];
    const outcome = gateway.createService(DRAFT, KEY, (attempt) => retries.push(attempt));
    const first = await respond(CREATE_SERVICE_RESPONSES.upstreamUnavailable);
    const second = await respond({ status: 0, body: null });
    const third = await respond(CREATE_SERVICE_RESPONSES.created, {
      'Idempotent-Replayed': 'true',
    });

    expect(retries).toEqual([1, 2]);
    expect(
      [first, second, third].map((request) => request.request.headers.get('Idempotency-Key')),
    ).toEqual([KEY, KEY, KEY]);
    expect((await outcome).kind).toBe('created');
  });

  it('reintenta como máximo tres veces y después falla de forma trazable', async () => {
    const outcome = gateway.createService(DRAFT, KEY);
    await respond(CREATE_SERVICE_RESPONSES.upstreamTimeout);
    await respond(CREATE_SERVICE_RESPONSES.upstreamUnavailable);
    await respond({ status: 502, body: { code: 'bad_gateway', message: 'simulado' } });
    await respond(CREATE_SERVICE_RESPONSES.upstreamTimeout);

    expect(await outcome).toEqual(
      jasmine.objectContaining({
        kind: 'failed',
        error: jasmine.objectContaining({
          kind: 'server',
          code: 'upstream_timeout',
          correlationId: SIMULATED_SERVICE_CORRELATION_ID,
        }),
      }),
    );
  });

  it('una respuesta 4xx no se repite automáticamente', async () => {
    const outcome = gateway.createService(DRAFT, KEY);
    await respond(CREATE_SERVICE_RESPONSES.validationError);
    await outcome;

    await new Promise((resolve) => setTimeout(resolve));
    http.expectNone(URL);
  });

  it('un 201 sin cuerpo no se presenta como éxito', async () => {
    const outcome = gateway.createService(DRAFT, KEY);
    await respond({ status: 201, body: null });

    expect((await outcome).kind).toBe('failed');
  });

  it('401 invalid_access_token termina la sesión como vencida', async () => {
    const outcome = gateway.createService(DRAFT, KEY);
    await respond(CREATE_SERVICE_RESPONSES.invalidAccessToken);

    expect((await outcome).kind).toBe('failed');
    expect(session.lastEndReason()).toBe('expired');
  });

  it('sin access token vigente no llama al BFF', async () => {
    session.end();

    expect((await gateway.createService(DRAFT, KEY)).kind).toBe('failed');
    expect(session.lastEndReason()).toBe('expired');
    http.expectNone(URL);
  });
});
