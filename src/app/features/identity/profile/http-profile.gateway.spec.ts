import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import {
  DEMOGRAPHIC_RESPONSES,
  GET_PROFILE_RESPONSES,
  PHYSIOLOGICAL_RESPONSES,
  SIMULATED_HEALTH_CONSENT_VERSION,
  SIMULATED_PROFILE_CORRELATION_ID,
  SIMULATED_PROFILE_USER_ID,
  SPORT_HABITS_RESPONSES,
  VALID_DEMOGRAPHIC_REQUEST,
  VALID_PHYSIOLOGICAL_REQUEST,
  VALID_SPORT_HABITS_REQUEST,
} from '../../../../testing/bff-web/profile.fixtures';
import { SimulatedResponse } from '../../../../testing/bff-web/register-user.fixtures';
import { APP_CONFIG, AppConfig } from '../../../core/config/app-config';
import { SessionStore } from '../../../core/session/session.store';
import { HttpProfileGateway, PROFILE_RETRY_DELAYS_MS } from './http-profile.gateway';
import { DemographicDraft, PhysiologicalDraft, SportHabitsDraft } from './profile.model';

const BFF = 'http://bff.example.com';
const PROFILE_URL = `${BFF}/v1/me/profile`;
const DEMOGRAPHIC_URL = `${BFF}/v1/me/demographic-profile`;
const PHYSIOLOGICAL_URL = `${BFF}/v1/me/physiological-profile`;
const SPORT_HABITS_URL = `${BFF}/v1/me/sport-habits`;
const KEY = '5f0c3a2e-8b1d-4c6e-9a7f-2d4b6c8e0a1f';
const TOKEN = 'token-sintetico';

const DEMOGRAPHIC_DRAFT: DemographicDraft = {
  birthDate: '1992-04-18',
  gender: 'FEMALE',
  countryCode: 'CO',
  city: 'Bogotá',
  maritalStatus: 'SINGLE',
  occupation: 'Ingeniera',
  incomeRange: '2_4_SMMLV',
};

const PHYSIOLOGICAL_DRAFT: PhysiologicalDraft = {
  consentVersion: SIMULATED_HEALTH_CONSENT_VERSION,
  measuredAt: '2026-10-12T13:00:00Z',
  weightKg: '68.5',
  heightCm: 172,
  restingHeartRateBpm: 58,
  bloodPressure: { systolic: 118, diastolic: 76 },
  bodyTemperatureC: '36.6',
};

/** Días y franjas fuera del orden del catálogo: el cuerpo los envía ordenados. */
const SPORT_HABITS_DRAFT: SportHabitsDraft = {
  sports: [
    {
      sport: 'running',
      frequencyPerWeek: 3,
      sessionDurationMinutes: 45,
      intensity: 'MODERATE',
      level: 'INTERMEDIATE',
      yearsPracticing: 4,
    },
    {
      sport: 'swimming',
      frequencyPerWeek: 1,
      sessionDurationMinutes: 60,
      intensity: 'LOW',
      level: 'BEGINNER',
      yearsPracticing: null,
    },
  ],
  days: ['SAT', 'MON', 'WED'],
  timeSlots: ['MORNING'],
  primaryGoal: 'HEALTH',
};

describe('HttpProfileGateway (HU005 y HU006, contrato bff-web 0.19.0)', () => {
  let http: HttpTestingController;
  let session: SessionStore;
  let gateway: HttpProfileGateway;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        HttpProfileGateway,
        { provide: PROFILE_RETRY_DELAYS_MS, useValue: [0, 0, 0] },
        {
          provide: APP_CONFIG,
          useValue: {
            environment: 'local',
            bffWebBaseUrl: BFF,
            registrationPoliciesVersion: null,
            healthDataConsentVersion: SIMULATED_HEALTH_CONSENT_VERSION,
          } satisfies AppConfig,
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    session = TestBed.inject(SessionStore);
    gateway = TestBed.inject(HttpProfileGateway);
    session.start({
      user: {
        id: SIMULATED_PROFILE_USER_ID,
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
    let pending = http.match(url);
    for (let tick = 0; pending.length === 0 && tick < 20; tick++) {
      await new Promise((resolve) => setTimeout(resolve));
      pending = http.match(url);
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

  describe('consulta del perfil', () => {
    it('consulta con el token y transforma el perfil proyectado', async () => {
      const profile = gateway.loadProfile();
      const request = await respond(PROFILE_URL, GET_PROFILE_RESPONSES.full);

      expect(request.request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
      const loaded = await profile;
      expect(loaded.demographic?.version).toBe(1);
      expect(loaded.physiological?.bmi).toBe('23.2');
    });

    it('un perfil sin secciones se devuelve con secciones null, no como error', async () => {
      const profile = gateway.loadProfile();
      await respond(PROFILE_URL, GET_PROFILE_RESPONSES.empty);

      expect(await profile).toEqual({
        demographic: null,
        physiological: null,
        sportHabits: null,
        projectedAt: null,
      });
    });

    it('CA5: 403 permission_required rechaza con el error original', async () => {
      const profile = gateway.loadProfile();
      await respond(PROFILE_URL, GET_PROFILE_RESPONSES.permissionRequired);

      await expectAsync(profile).toBeRejectedWith(jasmine.any(HttpErrorResponse));
    });

    it('401 invalid_access_token termina la sesión como vencida', async () => {
      const profile = gateway.loadProfile();
      await respond(PROFILE_URL, GET_PROFILE_RESPONSES.invalidAccessToken);

      await expectAsync(profile).toBeRejectedWith(jasmine.any(HttpErrorResponse));
      expect(session.lastEndReason()).toBe('expired');
    });

    it('sin access token no llama al BFF y termina la sesión', async () => {
      session.end();

      await expectAsync(gateway.loadProfile()).toBeRejectedWith(jasmine.any(HttpErrorResponse));
      http.expectNone(PROFILE_URL);
      expect(session.lastEndReason()).toBe('expired');
    });
  });

  describe('comando demográfico', () => {
    it('CA1: crea con token, clave y el cuerpo de ADR-034, y distingue 201', async () => {
      const outcome = gateway.saveDemographic(DEMOGRAPHIC_DRAFT, null, KEY);
      const request = await respond(DEMOGRAPHIC_URL, DEMOGRAPHIC_RESPONSES.created);

      expect(request.request.method).toBe('PUT');
      expect(request.request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
      expect(request.request.headers.get('Idempotency-Key')).toBe(KEY);
      expect(request.request.body).toEqual(VALID_DEMOGRAPHIC_REQUEST);
      expect(await outcome).toEqual({
        kind: 'saved',
        created: true,
        replayed: false,
        section: jasmine.objectContaining({ version: 1, city: 'Bogotá', countryCode: 'CO' }),
      });
    });

    it('CA1: reemplaza con expected_version y distingue 200', async () => {
      const outcome = gateway.saveDemographic(DEMOGRAPHIC_DRAFT, 1, KEY);
      const request = await respond(DEMOGRAPHIC_URL, DEMOGRAPHIC_RESPONSES.replaced);

      expect(request.request.body.expected_version).toBe(1);
      expect(await outcome).toEqual(
        jasmine.objectContaining({
          kind: 'saved',
          created: false,
          section: jasmine.objectContaining({ version: 2, city: 'Medellín' }),
        }),
      );
    });

    it('CA6: reconoce el resultado de un reintento por Idempotent-Replayed', async () => {
      const outcome = gateway.saveDemographic(DEMOGRAPHIC_DRAFT, null, KEY);
      await respond(DEMOGRAPHIC_URL, DEMOGRAPHIC_RESPONSES.created, {
        'Idempotent-Replayed': 'true',
      });

      expect(await outcome).toEqual(jasmine.objectContaining({ kind: 'saved', replayed: true }));
    });

    it('CA2: traduce validation_error a reglas por campo', async () => {
      const outcome = gateway.saveDemographic(DEMOGRAPHIC_DRAFT, null, KEY);
      await respond(DEMOGRAPHIC_URL, DEMOGRAPHIC_RESPONSES.validationError);

      expect(await outcome).toEqual({
        kind: 'invalid',
        violations: [
          { field: 'birth_date', issue: 'out_of_range' },
          { field: 'country_code', issue: 'unknown_value' },
          { field: 'user_id', issue: 'field_not_allowed' },
        ],
      });
    });

    it('CA6: version_conflict informa la versión vigente', async () => {
      const outcome = gateway.saveDemographic(DEMOGRAPHIC_DRAFT, 1, KEY);
      await respond(DEMOGRAPHIC_URL, DEMOGRAPHIC_RESPONSES.versionConflict);

      expect(await outcome).toEqual({ kind: 'conflict', currentVersion: 2 });
    });

    it('CA6: version_conflict de una sección inexistente informa la versión 0', async () => {
      const outcome = gateway.saveDemographic(DEMOGRAPHIC_DRAFT, 3, KEY);
      await respond(DEMOGRAPHIC_URL, DEMOGRAPHIC_RESPONSES.versionConflictMissing);

      expect(await outcome).toEqual({ kind: 'conflict', currentVersion: 0 });
    });

    it('idempotency_key_reused es un fallo seguro con su código', async () => {
      const outcome = gateway.saveDemographic(DEMOGRAPHIC_DRAFT, null, KEY);
      await respond(DEMOGRAPHIC_URL, DEMOGRAPHIC_RESPONSES.idempotencyKeyReused);

      expect(await outcome).toEqual({
        kind: 'failed',
        error: {
          kind: 'conflict',
          status: 409,
          code: 'idempotency_key_reused',
          correlationId: SIMULATED_PROFILE_CORRELATION_ID,
        },
      });
    });

    it('CA5: permission_required se informa como permiso denegado, sin reintentar', async () => {
      const outcome = gateway.saveDemographic(DEMOGRAPHIC_DRAFT, null, KEY);
      await respond(DEMOGRAPHIC_URL, DEMOGRAPHIC_RESPONSES.permissionRequired);

      expect(await outcome).toEqual(
        jasmine.objectContaining({
          kind: 'failed',
          error: jasmine.objectContaining({ kind: 'forbidden', code: 'permission_required' }),
        }),
      );
      http.expectNone(DEMOGRAPHIC_URL);
    });
  });

  describe('comando fisiológico', () => {
    it('CA1: envía consentimiento, decimales como texto y measured_at en UTC; recibe el IMC', async () => {
      const outcome = gateway.savePhysiological(PHYSIOLOGICAL_DRAFT, null, KEY);
      const request = await respond(PHYSIOLOGICAL_URL, PHYSIOLOGICAL_RESPONSES.created);

      expect(request.request.method).toBe('PUT');
      expect(request.request.headers.get('Idempotency-Key')).toBe(KEY);
      expect(request.request.body).toEqual(VALID_PHYSIOLOGICAL_REQUEST);
      expect(request.request.body.bmi).toBeUndefined();
      expect(await outcome).toEqual(
        jasmine.objectContaining({
          kind: 'saved',
          created: true,
          section: jasmine.objectContaining({ bmi: '23.2', weightKg: '68.5' }),
        }),
      );
    });

    it('CA3: un consentimiento no vigente se informa en consent.version', async () => {
      const outcome = gateway.savePhysiological(PHYSIOLOGICAL_DRAFT, null, KEY);
      await respond(PHYSIOLOGICAL_URL, PHYSIOLOGICAL_RESPONSES.unsupportedConsentVersion);

      expect(await outcome).toEqual({
        kind: 'invalid',
        violations: [{ field: 'consent.version', issue: 'unsupported_consent_version' }],
      });
    });

    it('retira el prefijo body de las rutas de details', async () => {
      const outcome = gateway.savePhysiological(PHYSIOLOGICAL_DRAFT, null, KEY);
      await respond(PHYSIOLOGICAL_URL, {
        status: 422,
        body: {
          code: 'validation_error',
          message: 'La solicitud no es válida.',
          correlation_id: SIMULATED_PROFILE_CORRELATION_ID,
          details: [
            { field: 'body.weight_kg', issue: 'too_many_decimals' },
            { field: null, issue: 'required' },
          ],
        },
      });

      expect(await outcome).toEqual({
        kind: 'invalid',
        violations: [
          { field: 'weight_kg', issue: 'too_many_decimals' },
          { field: '', issue: 'required' },
        ],
      });
    });
  });

  describe('comando de hábitos deportivos (HU006)', () => {
    it('CA1: crea con token, clave y el cuerpo de ADR-034, y recibe la sección normalizada', async () => {
      const outcome = gateway.saveSportHabits(SPORT_HABITS_DRAFT, null, KEY);
      const request = await respond(SPORT_HABITS_URL, SPORT_HABITS_RESPONSES.created);

      expect(request.request.method).toBe('PUT');
      expect(request.request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
      expect(request.request.headers.get('Idempotency-Key')).toBe(KEY);
      // Sin `expected_version` ni `user_id`; días y franjas en el orden del catálogo.
      expect(request.request.body).toEqual(VALID_SPORT_HABITS_REQUEST);
      expect(await outcome).toEqual({
        kind: 'saved',
        created: true,
        replayed: false,
        section: {
          version: 1,
          sports: SPORT_HABITS_DRAFT.sports,
          days: ['MON', 'WED', 'SAT'],
          timeSlots: ['MORNING'],
          primaryGoal: 'HEALTH',
          updatedAt: SPORT_HABITS_RESPONSES.created.body.updated_at,
        },
      });
    });

    it('CA1: reemplaza con expected_version y distingue 200', async () => {
      const outcome = gateway.saveSportHabits(SPORT_HABITS_DRAFT, 1, KEY);
      const request = await respond(SPORT_HABITS_URL, SPORT_HABITS_RESPONSES.replaced);

      expect(request.request.body.expected_version).toBe(1);
      expect(await outcome).toEqual(
        jasmine.objectContaining({
          kind: 'saved',
          created: false,
          section: jasmine.objectContaining({ version: 2, primaryGoal: null }),
        }),
      );
    });

    it('CA4: reconoce el resultado de un reintento por Idempotent-Replayed', async () => {
      const outcome = gateway.saveSportHabits(SPORT_HABITS_DRAFT, null, KEY);
      await respond(SPORT_HABITS_URL, SPORT_HABITS_RESPONSES.created, {
        'Idempotent-Replayed': 'true',
      });

      expect(await outcome).toEqual(jasmine.objectContaining({ kind: 'saved', replayed: true }));
    });

    it('CA2: traduce validation_error conservando la posición de cada lista', async () => {
      const outcome = gateway.saveSportHabits(SPORT_HABITS_DRAFT, null, KEY);
      await respond(SPORT_HABITS_URL, SPORT_HABITS_RESPONSES.validationError);

      expect(await outcome).toEqual({
        kind: 'invalid',
        violations: [
          { field: 'sports[1].sport', issue: 'duplicate_value' },
          { field: 'sports[0].frequency_per_week', issue: 'out_of_range' },
          { field: 'availability.days[1]', issue: 'duplicate_value' },
        ],
      });
    });

    it('CA4: version_conflict informa la versión vigente', async () => {
      const outcome = gateway.saveSportHabits(SPORT_HABITS_DRAFT, 1, KEY);
      await respond(SPORT_HABITS_URL, SPORT_HABITS_RESPONSES.versionConflict);

      expect(await outcome).toEqual({ kind: 'conflict', currentVersion: 2 });
    });

    it('CA5: permission_required se informa como permiso denegado, sin reintentar', async () => {
      const outcome = gateway.saveSportHabits(SPORT_HABITS_DRAFT, null, KEY);
      await respond(SPORT_HABITS_URL, SPORT_HABITS_RESPONSES.permissionRequired);

      expect(await outcome).toEqual(
        jasmine.objectContaining({
          kind: 'failed',
          error: jasmine.objectContaining({ kind: 'forbidden', code: 'permission_required' }),
        }),
      );
      http.expectNone(SPORT_HABITS_URL);
    });

    it('CA4: ante 503 reintenta con la misma clave y el mismo cuerpo', async () => {
      const retries: number[] = [];
      const outcome = gateway.saveSportHabits(SPORT_HABITS_DRAFT, null, KEY, (attempt) =>
        retries.push(attempt),
      );
      const first = await respond(SPORT_HABITS_URL, SPORT_HABITS_RESPONSES.upstreamUnavailable);
      const second = await respond(SPORT_HABITS_URL, SPORT_HABITS_RESPONSES.created);

      expect(second.request.headers.get('Idempotency-Key')).toBe(KEY);
      expect(second.request.body).toEqual(first.request.body);
      expect(retries).toEqual([1]);
      expect(await outcome).toEqual(jasmine.objectContaining({ kind: 'saved', created: true }));
    });

    it('la consulta del perfil transforma los hábitos proyectados', async () => {
      const profile = gateway.loadProfile();
      await respond(PROFILE_URL, GET_PROFILE_RESPONSES.withSportHabits);

      const loaded = await profile;
      expect(loaded.sportHabits?.version).toBe(1);
      expect(loaded.sportHabits?.sports.map((habit) => habit.sport)).toEqual([
        'running',
        'swimming',
      ]);
      expect(loaded.sportHabits?.days).toEqual(['MON', 'WED', 'SAT']);
    });
  });

  describe('reintentos automáticos', () => {
    it('ante red, 502, 503 y 504 reintenta hasta tres veces con la misma clave', async () => {
      const retries: number[] = [];
      const outcome = gateway.savePhysiological(PHYSIOLOGICAL_DRAFT, null, KEY, (attempt) =>
        retries.push(attempt),
      );

      const keys = [
        await respond(PHYSIOLOGICAL_URL, { status: 0, body: null }),
        await respond(PHYSIOLOGICAL_URL, { status: 502, body: null }),
        await respond(PHYSIOLOGICAL_URL, PHYSIOLOGICAL_RESPONSES.upstreamUnavailable),
        await respond(PHYSIOLOGICAL_URL, PHYSIOLOGICAL_RESPONSES.created, {
          'Idempotent-Replayed': 'true',
        }),
      ].map((request) => request.request.headers.get('Idempotency-Key'));

      expect(keys).toEqual([KEY, KEY, KEY, KEY]);
      expect(retries).toEqual([1, 2, 3]);
      expect(await outcome).toEqual(jasmine.objectContaining({ kind: 'saved', replayed: true }));
    });

    it('tras agotar los reintentos devuelve un fallo recuperable, nunca éxito', async () => {
      const outcome = gateway.saveDemographic(DEMOGRAPHIC_DRAFT, null, KEY);
      for (let attempt = 0; attempt < 4; attempt++) {
        await respond(DEMOGRAPHIC_URL, DEMOGRAPHIC_RESPONSES.upstreamTimeout);
      }

      expect(await outcome).toEqual(
        jasmine.objectContaining({
          kind: 'failed',
          error: jasmine.objectContaining({ kind: 'server', code: 'upstream_timeout' }),
        }),
      );
      http.expectNone(DEMOGRAPHIC_URL);
    });

    it('no reintenta un 422 ni un 409', async () => {
      const invalid = gateway.saveDemographic(DEMOGRAPHIC_DRAFT, null, KEY);
      await respond(DEMOGRAPHIC_URL, DEMOGRAPHIC_RESPONSES.validationError);
      await invalid;
      const conflict = gateway.saveDemographic(DEMOGRAPHIC_DRAFT, 1, KEY);
      await respond(DEMOGRAPHIC_URL, DEMOGRAPHIC_RESPONSES.versionConflict);
      await conflict;

      http.expectNone(DEMOGRAPHIC_URL);
    });
  });

  it('un 401 invalid_access_token en un comando termina la sesión', async () => {
    const outcome = gateway.saveDemographic(DEMOGRAPHIC_DRAFT, null, KEY);
    await respond(DEMOGRAPHIC_URL, DEMOGRAPHIC_RESPONSES.invalidAccessToken);

    expect(await outcome).toEqual(
      jasmine.objectContaining({
        kind: 'failed',
        error: jasmine.objectContaining({ kind: 'unauthenticated' }),
      }),
    );
    expect(session.lastEndReason()).toBe('expired');
  });

  it('una respuesta sin cuerpo no se presenta como éxito', async () => {
    const outcome = gateway.saveDemographic(DEMOGRAPHIC_DRAFT, null, KEY);
    await respond(DEMOGRAPHIC_URL, { status: 201, body: null });

    expect((await outcome).kind).toBe('failed');
  });
});
