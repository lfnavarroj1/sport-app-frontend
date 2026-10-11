import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import {
  REGISTER_USER_RESPONSES,
  SIMULATED_CORRELATION_ID,
  SimulatedResponse,
} from '../../../../testing/bff-web/register-user.fixtures';
import { BffNotConfiguredError } from '../../../core/api/bff-web-url';
import { APP_CONFIG, AppConfig, ConfigValueMissingError } from '../../../core/config/app-config';
import { HttpRegistrationGateway } from './http-registration.gateway';
import { RegistrationDraft, RegistrationOutcome } from './registration.model';

const BFF = 'http://bff.example.com';
const KEY = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

const DRAFT: RegistrationDraft = {
  fullName: 'Persona Sintética',
  email: 'persona@example.com',
  password: 'clave-sintetica-123',
  actorType: 'athlete',
  acceptedPoliciesVersion: 'local-dev',
};

describe('HttpRegistrationGateway (HU001, contrato bff-web 0.2.0)', () => {
  let http: HttpTestingController;

  function setup(config: Partial<AppConfig> = {}): HttpRegistrationGateway {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        HttpRegistrationGateway,
        {
          provide: APP_CONFIG,
          useValue: {
            environment: 'local',
            bffWebBaseUrl: BFF,
            registrationPoliciesVersion: 'local-dev',
            ...config,
          } satisfies AppConfig,
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    return TestBed.inject(HttpRegistrationGateway);
  }

  /** Envía el borrador y responde con la respuesta simulada del contrato. */
  async function registerWith(response: SimulatedResponse): Promise<RegistrationOutcome> {
    const gateway = setup();
    const outcome = gateway.register(DRAFT, KEY);
    http
      .expectOne(`${BFF}/v1/users`)
      .flush(response.body as object | string, { status: response.status, statusText: 'simulado' });
    return outcome;
  }

  afterEach(() => http?.verify());

  describe('loadOptions', () => {
    it('ofrece los tipos de actor del contrato y la versión de políticas configurada', async () => {
      const options = await setup().loadOptions();

      expect(options).toEqual({
        actorTypes: [{ code: 'athlete' }, { code: 'organizer' }, { code: 'service_provider' }],
        policiesVersion: 'local-dev',
      });
    });

    it('falla si el BFF no está configurado en el ambiente', async () => {
      await expectAsync(setup({ bffWebBaseUrl: null }).loadOptions()).toBeRejectedWithError(
        BffNotConfiguredError,
      );
    });

    it('falla si la versión de políticas no está configurada en el ambiente', async () => {
      await expectAsync(
        setup({ registrationPoliciesVersion: null }).loadOptions(),
      ).toBeRejectedWithError(ConfigValueMissingError);
    });
  });

  describe('register', () => {
    it('traduce el borrador al contrato y envía la clave de idempotencia', async () => {
      const gateway = setup();

      const outcome = gateway.register(DRAFT, KEY);
      const request = http.expectOne(`${BFF}/v1/users`);
      request.flush(REGISTER_USER_RESPONSES.registered.body, {
        status: 201,
        statusText: 'Created',
      });

      expect(request.request.body).toEqual({
        full_name: 'Persona Sintética',
        email: 'persona@example.com',
        password: 'clave-sintetica-123',
        actor_type: 'athlete',
        accepted_policies_version: 'local-dev',
      });
      expect(request.request.headers.get('Idempotency-Key')).toBe(KEY);
      expect(await outcome).toEqual({
        kind: 'registered',
        userId: REGISTER_USER_RESPONSES.registered.body.user_id,
        email: 'persona@example.com',
      });
    });

    it('CA2: 409 email_already_registered → correo ya registrado', async () => {
      expect(await registerWith(REGISTER_USER_RESPONSES.emailAlreadyRegistered)).toEqual({
        kind: 'email_taken',
      });
    });

    it('CA3: 422 validation_error → campos rechazados por el backend', async () => {
      expect(await registerWith(REGISTER_USER_RESPONSES.validationError)).toEqual({
        kind: 'invalid',
        fields: ['email', 'password'],
      });
    });

    it('422 policies_version_mismatch → políticas desactualizadas', async () => {
      expect(await registerWith(REGISTER_USER_RESPONSES.policiesVersionMismatch)).toEqual({
        kind: 'policies_outdated',
      });
    });

    it('422 validation_error sin campos reconocibles → error de validación genérico', async () => {
      const outcome = await registerWith({
        status: 422,
        body: { ...REGISTER_USER_RESPONSES.validationError.body, details: [{ issue: 'x' }] },
      });

      expect(outcome).toEqual({
        kind: 'failed',
        error: {
          kind: 'validation',
          status: 422,
          code: 'validation_error',
          correlationId: SIMULATED_CORRELATION_ID,
        },
      });
    });

    const technicalFailures: [string, SimulatedResponse, string][] = [
      ['409 idempotency_key_reused', REGISTER_USER_RESPONSES.idempotencyKeyReused, 'conflict'],
      ['503 upstream_unavailable', REGISTER_USER_RESPONSES.upstreamUnavailable, 'server'],
      ['504 upstream_timeout', REGISTER_USER_RESPONSES.upstreamTimeout, 'server'],
    ];
    for (const [name, response, kind] of technicalFailures) {
      it(`${name} → fallo trazable, nunca éxito`, async () => {
        const outcome = await registerWith(response);

        expect(outcome).toEqual({
          kind: 'failed',
          error: {
            kind: kind as 'conflict' | 'server',
            status: response.status,
            code: (response.body as { code: string }).code,
            correlationId: SIMULATED_CORRELATION_ID,
          },
        });
      });
    }

    it('sin conexión → fallo de tipo offline', async () => {
      const gateway = setup();

      const outcome = gateway.register(DRAFT, KEY);
      http.expectOne(`${BFF}/v1/users`).error(new ProgressEvent('error'), { status: 0 });

      expect(await outcome).toEqual({
        kind: 'failed',
        error: { kind: 'offline', status: null, code: null, correlationId: null },
      });
    });

    it('una respuesta de error sin el formato del contrato no se interpreta como éxito', async () => {
      const outcome = await registerWith({ status: 500, body: '<html>error</html>' });

      expect(outcome).toEqual({
        kind: 'failed',
        error: { kind: 'server', status: 500, code: null, correlationId: null },
      });
    });

    it('sin URL del BFF → fallo "no configurado" sin llamar a nadie', async () => {
      const gateway = setup({ bffWebBaseUrl: null });

      expect(await gateway.register(DRAFT, KEY)).toEqual({
        kind: 'failed',
        error: { kind: 'not_configured', status: null, code: null, correlationId: null },
      });
    });
  });
});
