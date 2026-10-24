import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { SimulatedResponse } from '../../../../testing/bff-web/register-user.fixtures';
import {
  ASSOCIATE_SERVICE_RESPONSES,
  DISSOCIATE_SERVICE_RESPONSES,
  SERVICE_ASSOCIATIONS_NEXT_CURSOR,
  SERVICE_ASSOCIATIONS_RESPONSES,
  serviceAssociation,
} from '../../../../testing/bff-web/service-associations.fixtures';
import { APP_CONFIG, AppConfig } from '../../../core/config/app-config';
import { SessionStore } from '../../../core/session/session.store';
import {
  ASSOCIATE_SERVICE_RETRY_DELAYS_MS,
  HttpServiceAssociationsGateway,
} from './http-service-associations.gateway';

const BFF = 'http://bff.example.com';
const ASSOCIATIONS_URL = `${BFF}/v1/me/service-associations`;
const ASSOCIATION = serviceAssociation(0);
const ASSOCIATION_URL = `${ASSOCIATIONS_URL}/${ASSOCIATION.association_id}`;
const KEY = '4b6d8f0a-2c4e-4a6c-8e0a-2c4e6a8c0e2a';
const TOKEN = 'token-sintetico';

describe('HttpServiceAssociationsGateway (HU017, contrato bff-web 0.25.0)', () => {
  let http: HttpTestingController;
  let session: SessionStore;
  let gateway: HttpServiceAssociationsGateway;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        HttpServiceAssociationsGateway,
        { provide: ASSOCIATE_SERVICE_RETRY_DELAYS_MS, useValue: [0, 0, 0] },
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
    gateway = TestBed.inject(HttpServiceAssociationsGateway);
    session.start({
      user: {
        id: '8a0c2e4a-6c8e-4a0c-8e2a-4c6e8a0c2e4a',
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
    it('pide las activas con el tamaño del contrato y las transforma', async () => {
      const page = gateway.loadPage('ACTIVE', null);
      const request = await respond(ASSOCIATIONS_URL, SERVICE_ASSOCIATIONS_RESPONSES.firstPage);

      expect(request.request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
      expect(request.request.params.get('status')).toBe('ACTIVE');
      expect(request.request.params.get('limit')).toBe('20');
      expect(request.request.params.has('cursor')).toBeFalse();
      const result = await page;
      expect(result.associations.length).toBe(20);
      expect(result.associations[0]).toEqual(
        jasmine.objectContaining({
          id: ASSOCIATION.association_id,
          serviceId: ASSOCIATION.service_id,
          name: ASSOCIATION.service.name,
          category: 'SPORTS_MEDICINE',
          fee: { amount: ASSOCIATION.service.fee.amount, billingUnit: 'SESSION' },
          status: 'ACTIVE',
          endedAt: null,
        }),
      );
      expect(result.nextCursor).toBe(SERVICE_ASSOCIATIONS_NEXT_CURSOR);
    });

    it('CA5: pide el historial con status=ALL y el cursor sin modificar', async () => {
      const page = gateway.loadPage('ALL', SERVICE_ASSOCIATIONS_NEXT_CURSOR);
      const request = await respond(ASSOCIATIONS_URL, SERVICE_ASSOCIATIONS_RESPONSES.withHistory);

      expect(request.request.params.get('status')).toBe('ALL');
      expect(request.request.params.get('cursor')).toBe(SERVICE_ASSOCIATIONS_NEXT_CURSOR);
      const inactive = (await page).associations[1];
      expect(inactive.status).toBe('INACTIVE');
      expect(inactive.endedAt).not.toBeNull();
    });

    it('un fallo llega como error, nunca como lista vacía; 401 termina la sesión', async () => {
      const page = gateway.loadPage('ACTIVE', null);
      await respond(ASSOCIATIONS_URL, SERVICE_ASSOCIATIONS_RESPONSES.invalidAccessToken);

      await expectAsync(page).toBeRejectedWith(jasmine.any(HttpErrorResponse));
      expect(session.lastEndReason()).toBe('expired');
    });

    it('403 capability_required llega como error sin terminar la sesión', async () => {
      const page = gateway.loadPage('ACTIVE', null);
      await respond(ASSOCIATIONS_URL, SERVICE_ASSOCIATIONS_RESPONSES.capabilityRequired);

      await expectAsync(page).toBeRejected();
      expect(session.accessToken()).toBe(TOKEN);
    });

    it('sin access token vigente no llama al BFF', async () => {
      session.end();

      await expectAsync(gateway.loadPage('ACTIVE', null)).toBeRejected();
      http.expectNone(ASSOCIATIONS_URL);
    });
  });

  describe('asociar', () => {
    it('CA1: envía token, clave y {service_id}; devuelve la asociación confirmada', async () => {
      const outcome = gateway.associate(ASSOCIATION.service_id, KEY);
      const request = await respond(ASSOCIATIONS_URL, ASSOCIATE_SERVICE_RESPONSES.created);

      expect(request.request.method).toBe('POST');
      expect(request.request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
      expect(request.request.headers.get('Idempotency-Key')).toBe(KEY);
      expect(request.request.body).toEqual({ service_id: ASSOCIATION.service_id });
      const result = await outcome;
      expect(result.kind).toBe('associated');
      if (result.kind === 'associated') {
        expect(result.association.id).toBe(ASSOCIATION.association_id);
        expect(result.association.status).toBe('ACTIVE');
        expect(result.replayed).toBeFalse();
      }
    });

    it('CA3: reintenta ante la red y 503 con la misma clave e informa Idempotent-Replayed', async () => {
      const attempts: number[] = [];
      const outcome = gateway.associate(ASSOCIATION.service_id, KEY, (attempt) =>
        attempts.push(attempt),
      );
      const first = await respond(ASSOCIATIONS_URL, { status: 0, body: null });
      const second = await respond(
        ASSOCIATIONS_URL,
        ASSOCIATE_SERVICE_RESPONSES.upstreamUnavailable,
      );
      const third = await respond(ASSOCIATIONS_URL, ASSOCIATE_SERVICE_RESPONSES.created, {
        'Idempotent-Replayed': 'true',
      });

      for (const request of [first, second, third]) {
        expect(request.request.headers.get('Idempotency-Key')).toBe(KEY);
      }
      expect(attempts).toEqual([1, 2]);
      const result = await outcome;
      expect(result.kind === 'associated' && result.replayed).toBeTrue();
    });

    it('tras tres reintentos fallidos devuelve el error, nunca un éxito', async () => {
      const outcome = gateway.associate(ASSOCIATION.service_id, KEY);
      for (let attempt = 0; attempt < 4; attempt++) {
        await respond(ASSOCIATIONS_URL, ASSOCIATE_SERVICE_RESPONSES.upstreamTimeout);
      }

      expect(await outcome).toEqual({
        kind: 'failed',
        error: jasmine.objectContaining({ kind: 'server', code: 'upstream_timeout' }),
      });
    });

    it('CA3: 409 association_exists devuelve la asociación activa de details', async () => {
      const outcome = gateway.associate(ASSOCIATION.service_id, KEY);
      await respond(ASSOCIATIONS_URL, ASSOCIATE_SERVICE_RESPONSES.associationExists);

      expect(await outcome).toEqual({ kind: 'exists', associationId: ASSOCIATION.association_id });
    });

    it('CA2: 404 service_not_found y 403 capability_required no se reintentan', async () => {
      const notFound = gateway.associate(ASSOCIATION.service_id, KEY);
      await respond(ASSOCIATIONS_URL, ASSOCIATE_SERVICE_RESPONSES.serviceNotFound);
      expect(await notFound).toEqual({
        kind: 'failed',
        error: jasmine.objectContaining({ kind: 'not_found', code: 'service_not_found' }),
      });

      const forbidden = gateway.associate(ASSOCIATION.service_id, KEY);
      await respond(ASSOCIATIONS_URL, ASSOCIATE_SERVICE_RESPONSES.capabilityRequired);
      expect(await forbidden).toEqual({
        kind: 'failed',
        error: jasmine.objectContaining({ kind: 'forbidden', code: 'capability_required' }),
      });
    });

    it('401 invalid_access_token termina la sesión', async () => {
      const outcome = gateway.associate(ASSOCIATION.service_id, KEY);
      await respond(ASSOCIATIONS_URL, ASSOCIATE_SERVICE_RESPONSES.invalidAccessToken);

      expect((await outcome).kind).toBe('failed');
      expect(session.lastEndReason()).toBe('expired');
    });

    it('sin access token vigente no llama al BFF', async () => {
      session.end();

      expect((await gateway.associate(ASSOCIATION.service_id, KEY)).kind).toBe('failed');
      http.expectNone(ASSOCIATIONS_URL);
    });
  });

  describe('quitar', () => {
    it('CA5: DELETE con el token; 204 confirma', async () => {
      const outcome = gateway.dissociate(ASSOCIATION.association_id);
      const request = await respond(ASSOCIATION_URL, { status: 204, body: null });

      expect(request.request.method).toBe('DELETE');
      expect(request.request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
      expect(await outcome).toEqual({ kind: 'dissociated' });
    });

    it('404 association_not_found y 503 son fallos, nunca éxito', async () => {
      const notFound = gateway.dissociate(ASSOCIATION.association_id);
      await respond(ASSOCIATION_URL, DISSOCIATE_SERVICE_RESPONSES.associationNotFound);
      expect(await notFound).toEqual({
        kind: 'failed',
        error: jasmine.objectContaining({ kind: 'not_found', code: 'association_not_found' }),
      });

      const unavailable = gateway.dissociate(ASSOCIATION.association_id);
      await respond(ASSOCIATION_URL, DISSOCIATE_SERVICE_RESPONSES.upstreamUnavailable);
      expect((await unavailable).kind).toBe('failed');
    });
  });
});
