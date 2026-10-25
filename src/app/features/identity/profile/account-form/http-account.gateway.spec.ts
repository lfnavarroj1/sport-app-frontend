import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import {
  GET_ACCOUNT_RESPONSES,
  PUT_ACCOUNT_RESPONSES,
  SIMULATED_ACCOUNT_CORRELATION_ID,
  SIMULATED_ACCOUNT_USER_ID,
  VALID_ACCOUNT_REQUEST,
} from '../../../../../testing/bff-web/account.fixtures';
import { SimulatedResponse } from '../../../../../testing/bff-web/register-user.fixtures';
import { APP_CONFIG, AppConfig } from '../../../../core/config/app-config';
import { SessionStore } from '../../../../core/session/session.store';
import { AccountDraft } from './account.model';
import { ACCOUNT_RETRY_DELAYS_MS, HttpAccountGateway } from './http-account.gateway';

const BFF = 'http://bff.example.com';
const ACCOUNT_URL = `${BFF}/v1/me/account`;
const KEY = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const TOKEN = 'token-sintetico';

const DRAFT: AccountDraft = {
  fullName: VALID_ACCOUNT_REQUEST.full_name,
  email: VALID_ACCOUNT_REQUEST.email,
};

describe('HttpAccountGateway (HU002, contrato bff-web 0.28.0)', () => {
  let http: HttpTestingController;
  let session: SessionStore;
  let gateway: HttpAccountGateway;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        HttpAccountGateway,
        { provide: ACCOUNT_RETRY_DELAYS_MS, useValue: [0, 0, 0] },
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
    gateway = TestBed.inject(HttpAccountGateway);
    session.start({
      user: {
        id: SIMULATED_ACCOUNT_USER_ID,
        fullName: 'Persona Sintética',
        email: 'persona@example.com',
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
    let pending = http.match(ACCOUNT_URL);
    for (let tick = 0; pending.length === 0 && tick < 20; tick++) {
      await new Promise((resolve) => setTimeout(resolve));
      pending = http.match(ACCOUNT_URL);
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

  describe('consulta de la cuenta', () => {
    it('consulta con el token y transforma la cuenta proyectada', async () => {
      const account = gateway.loadAccount();
      const request = await respond(GET_ACCOUNT_RESPONSES.found);

      expect(request.request.method).toBe('GET');
      expect(request.request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
      expect(await account).toEqual({
        fullName: 'Persona Sintética',
        email: 'persona@example.com',
        version: 1,
      });
    });

    it('404 user_not_found rechaza con el error original (cuenta aún no proyectada)', async () => {
      const account = gateway.loadAccount();
      await respond(GET_ACCOUNT_RESPONSES.userNotFound);

      await expectAsync(account).toBeRejectedWith(jasmine.any(HttpErrorResponse));
      expect(session.isAuthenticated()).toBeTrue();
    });

    it('401 invalid_access_token termina la sesión como vencida', async () => {
      const account = gateway.loadAccount();
      await respond(GET_ACCOUNT_RESPONSES.invalidAccessToken);

      await expectAsync(account).toBeRejectedWith(jasmine.any(HttpErrorResponse));
      expect(session.lastEndReason()).toBe('expired');
    });

    it('sin access token no llama al BFF y termina la sesión', async () => {
      session.end();

      await expectAsync(gateway.loadAccount()).toBeRejectedWith(jasmine.any(HttpErrorResponse));
      http.expectNone(ACCOUNT_URL);
      expect(session.lastEndReason()).toBe('expired');
    });
  });

  describe('edición de la cuenta', () => {
    it('CA1: envía token, clave y exactamente expected_version, full_name y email', async () => {
      const outcome = gateway.saveAccount(DRAFT, 1, KEY);
      const request = await respond(PUT_ACCOUNT_RESPONSES.updated);

      expect(request.request.method).toBe('PUT');
      expect(request.request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
      expect(request.request.headers.get('Idempotency-Key')).toBe(KEY);
      // CA2: el cuerpo nunca lleva user_id, actor_type, status ni contraseña.
      expect(request.request.body).toEqual(VALID_ACCOUNT_REQUEST);
      expect(await outcome).toEqual({
        kind: 'saved',
        replayed: false,
        account: {
          fullName: 'Persona Renombrada',
          email: 'persona.nueva@example.com',
          version: 2,
        },
      });
    });

    it('CA5: reconoce el resultado de un reintento por Idempotent-Replayed', async () => {
      const outcome = gateway.saveAccount(DRAFT, 1, KEY);
      await respond(PUT_ACCOUNT_RESPONSES.updated, { 'Idempotent-Replayed': 'true' });

      expect(await outcome).toEqual(jasmine.objectContaining({ kind: 'saved', replayed: true }));
    });

    it('traduce validation_error a reglas por campo, sin el prefijo body', async () => {
      const outcome = gateway.saveAccount(DRAFT, 1, KEY);
      await respond({
        status: 422,
        body: {
          ...PUT_ACCOUNT_RESPONSES.validationError.body,
          details: [{ field: 'body.full_name', issue: 'invalid_length' }],
        },
      });

      expect(await outcome).toEqual({
        kind: 'invalid',
        violations: [{ field: 'full_name', issue: 'invalid_length' }],
      });
    });

    it('CA2: 422 field_not_allowed se devuelve como regla incumplida, no como éxito', async () => {
      const outcome = gateway.saveAccount(DRAFT, 1, KEY);
      await respond(PUT_ACCOUNT_RESPONSES.fieldNotAllowed);

      expect(await outcome).toEqual({
        kind: 'invalid',
        violations: [{ field: 'actor_type', issue: 'field_not_allowed' }],
      });
    });

    it('CA3: 409 email_already_registered → correo no disponible, sin más detalle', async () => {
      const outcome = gateway.saveAccount(DRAFT, 1, KEY);
      await respond(PUT_ACCOUNT_RESPONSES.emailAlreadyRegistered);

      expect(await outcome).toEqual({ kind: 'email_taken' });
    });

    it('CA4: 409 version_conflict informa la versión vigente', async () => {
      const outcome = gateway.saveAccount(DRAFT, 1, KEY);
      await respond(PUT_ACCOUNT_RESPONSES.versionConflict);

      expect(await outcome).toEqual({ kind: 'conflict', currentVersion: 3 });
    });

    it('409 idempotency_key_reused es un fallo con su código y su referencia', async () => {
      const outcome = gateway.saveAccount(DRAFT, 1, KEY);
      await respond(PUT_ACCOUNT_RESPONSES.idempotencyKeyReused);

      expect(await outcome).toEqual({
        kind: 'failed',
        error: {
          kind: 'conflict',
          status: 409,
          code: 'idempotency_key_reused',
          correlationId: SIMULATED_ACCOUNT_CORRELATION_ID,
        },
      });
    });

    it('reintenta sin red, 502, 503 y 504 con la misma clave y avisa cada reintento', async () => {
      const retries: number[] = [];
      const outcome = gateway.saveAccount(DRAFT, 1, KEY, (attempt) => retries.push(attempt));

      const keys = [
        await respond({ status: 0, body: null }),
        await respond({ status: 502, body: null }),
        await respond(PUT_ACCOUNT_RESPONSES.upstreamUnavailable),
        await respond(PUT_ACCOUNT_RESPONSES.updated),
      ].map((request) => request.request.headers.get('Idempotency-Key'));

      expect(keys).toEqual([KEY, KEY, KEY, KEY]);
      expect(retries).toEqual([1, 2, 3]);
      expect((await outcome).kind).toBe('saved');
    });

    it('tras tres reintentos fallidos devuelve el error, nunca un éxito', async () => {
      const outcome = gateway.saveAccount(DRAFT, 1, KEY);
      for (let i = 0; i < 4; i++) {
        await respond(PUT_ACCOUNT_RESPONSES.upstreamTimeout);
      }

      expect(await outcome).toEqual({
        kind: 'failed',
        error: jasmine.objectContaining({ kind: 'server', code: 'upstream_timeout' }),
      });
    });

    it('no reintenta un error que no es transitorio', async () => {
      const outcome = gateway.saveAccount(DRAFT, 1, KEY);
      await respond({ status: 500, body: null });

      expect(await outcome).toEqual({
        kind: 'failed',
        error: jasmine.objectContaining({ kind: 'server', status: 500 }),
      });
    });

    it('401 invalid_access_token termina la sesión', async () => {
      const outcome = gateway.saveAccount(DRAFT, 1, KEY);
      await respond(PUT_ACCOUNT_RESPONSES.invalidAccessToken);

      expect((await outcome).kind).toBe('failed');
      expect(session.lastEndReason()).toBe('expired');
    });

    it('sin access token no llama al BFF', async () => {
      session.end();

      expect(await gateway.saveAccount(DRAFT, 1, KEY)).toEqual({
        kind: 'failed',
        error: { kind: 'unauthenticated', status: null, code: null, correlationId: null },
      });
      http.expectNone(ACCOUNT_URL);
    });
  });
});
