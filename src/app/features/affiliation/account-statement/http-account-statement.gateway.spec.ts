import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { ACCOUNT_STATEMENT_RESPONSES } from '../../../../testing/bff-web/account-statement.fixtures';
import { SimulatedResponse } from '../../../../testing/bff-web/register-user.fixtures';
import { APP_CONFIG, AppConfig } from '../../../core/config/app-config';
import { SessionStore } from '../../../core/session/session.store';
import { STATEMENT_PAGE_SIZE } from './account-statement.model';
import { HttpAccountStatementGateway } from './http-account-statement.gateway';

const BFF = 'http://bff.example.com';
const STATEMENT_URL = `${BFF}/v1/me/account-statement`;
const TOKEN = 'token-sintetico';

describe('HttpAccountStatementGateway (HU007, contrato bff-web 0.28.0)', () => {
  let http: HttpTestingController;
  let session: SessionStore;
  let gateway: HttpAccountStatementGateway;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        HttpAccountStatementGateway,
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
    gateway = TestBed.inject(HttpAccountStatementGateway);
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

  /** Espera la siguiente solicitud del estado de cuenta y la responde. */
  async function respond(response: SimulatedResponse) {
    let pending = http.match((request) => request.url === STATEMENT_URL);
    for (let tick = 0; pending.length === 0 && tick < 20; tick++) {
      await new Promise((resolve) => setTimeout(resolve));
      pending = http.match((request) => request.url === STATEMENT_URL);
    }
    expect(pending.length).withContext('solicitudes pendientes').toBe(1);
    const request = pending[0];
    if (response.status === 0) {
      request.error(new ProgressEvent('error'));
    } else {
      request.flush(response.body as object, { status: response.status, statusText: 'simulado' });
    }
    return request;
  }

  it('CA1 y CA3: consulta la cuenta propia con el token y transforma la respuesta', async () => {
    const loaded = gateway.load();
    const request = await respond(ACCOUNT_STATEMENT_RESPONSES.activePremium);

    expect(request.request.method).toBe('GET');
    expect(request.request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
    // Sin identificador de usuario: la cuenta es la del token (CA3).
    expect(request.request.params.keys()).toEqual(['limit']);
    expect(request.request.params.get('limit')).toBe(String(STATEMENT_PAGE_SIZE));

    const statement = await loaded;
    expect(statement.status).toBe('ACTIVE');
    expect(statement.subscription).toEqual(
      jasmine.objectContaining({
        planCode: 'PREMIUM',
        periodicity: 'QUARTERLY',
        price: '14400.00',
      }),
    );
    expect(statement.commitments).toEqual([
      {
        id: '9e1b3d5f-7a9c-4e1b-8d5f-7a9c1e3b5d7f',
        planCode: 'PREMIUM',
        periodicity: 'QUARTERLY',
        amount: '14400.00',
        periodStart: '2026-10-24T15:00:00Z',
        periodEnd: '2027-01-24T15:00:00Z',
        dueAt: '2026-10-24T15:00:00Z',
        status: 'PENDING_EXTERNAL',
      },
    ]);
    expect(statement.movements.map((movement) => movement.type)).toEqual([
      'COMMITMENT_CREATED',
      'PLAN_CHANGED',
      'FREE_ACTIVATED',
    ]);
    expect(statement.movements[0].amount).toBe('14400.00');
    expect(statement.movements[1].amount).toBeNull();
    expect(statement.nextCursor).toBeNull();
  });

  it('CA2: NOT_APPLICABLE y PROVISIONING llegan como estados, no como errores', async () => {
    const notApplicable = gateway.load();
    await respond(ACCOUNT_STATEMENT_RESPONSES.notApplicable);
    expect(await notApplicable).toEqual({
      status: 'NOT_APPLICABLE',
      subscription: null,
      commitments: [],
      movements: [],
      nextCursor: null,
    });

    const provisioning = gateway.load();
    await respond(ACCOUNT_STATEMENT_RESPONSES.provisioning);
    expect((await provisioning).status).toBe('PROVISIONING');
  });

  it('CA5: la página siguiente envía el cursor sin modificar y devuelve solo los movimientos', async () => {
    const cursor = ACCOUNT_STATEMENT_RESPONSES.firstPage.body.next_cursor!;
    const page = gateway.loadMore(cursor);
    const request = await respond(ACCOUNT_STATEMENT_RESPONSES.lastPage);

    expect(request.request.params.get('cursor')).toBe(cursor);
    expect(request.request.params.get('limit')).toBe(String(STATEMENT_PAGE_SIZE));
    const result = await page;
    expect(result.movements.length).toBe(5);
    expect(result.nextCursor).toBeNull();
  });

  it('un fallo llega como error, nunca como estado vacío', async () => {
    const loaded = gateway.load();
    await respond(ACCOUNT_STATEMENT_RESPONSES.upstreamUnavailable);

    await expectAsync(loaded).toBeRejectedWith(jasmine.any(HttpErrorResponse));
    expect(session.accessToken()).toBe(TOKEN);
  });

  it('un 422 de cursor inválido se rechaza con su código', async () => {
    const page = gateway.loadMore('cursor-alterado');
    await respond(ACCOUNT_STATEMENT_RESPONSES.invalidCursor);

    await expectAsync(page).toBeRejectedWith(
      jasmine.objectContaining({
        status: 422,
        error: jasmine.objectContaining({ code: 'validation_error' }),
      }),
    );
  });

  it('401 invalid_access_token termina la sesión como vencida', async () => {
    const loaded = gateway.load();
    await respond(ACCOUNT_STATEMENT_RESPONSES.invalidAccessToken);

    await expectAsync(loaded).toBeRejected();
    expect(session.lastEndReason()).toBe('expired');
  });

  it('sin access token vigente no llama al BFF', async () => {
    session.end();

    await expectAsync(gateway.load()).toBeRejected();
    http.expectNone(STATEMENT_URL);
  });
});
