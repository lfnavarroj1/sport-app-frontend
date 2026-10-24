import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import {
  ATTENDEES_EVENT,
  ATTENDEES_NEXT_CURSOR,
  EVENT_ATTENDEES_RESPONSES,
} from '../../../../testing/bff-web/event-attendees.fixtures';
import { MY_EVENTS_RESPONSES } from '../../../../testing/bff-web/publish-event.fixtures';
import { SimulatedResponse } from '../../../../testing/bff-web/register-user.fixtures';
import { APP_CONFIG, AppConfig } from '../../../core/config/app-config';
import { SessionStore } from '../../../core/session/session.store';
import { HttpAttendeesGateway } from './http-attendees.gateway';

const BFF = 'http://bff.example.com';
const MY_EVENTS_URL = `${BFF}/v1/me/events`;
const ATTENDEES_URL = `${BFF}/v1/me/events/${ATTENDEES_EVENT.event_id}/registrations`;
const TOKEN = 'token-sintetico';

describe('HttpAttendeesGateway (HU022, contrato bff-web 0.22.0)', () => {
  let http: HttpTestingController;
  let session: SessionStore;
  let gateway: HttpAttendeesGateway;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        HttpAttendeesGateway,
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
    gateway = TestBed.inject(HttpAttendeesGateway);
    session.start({
      user: {
        id: '2b4d6f8a-0c2e-4a6c-8e0a-2c4e6a8c0e2a',
        fullName: 'Organizadora Sintética',
        email: 'organizadora@example.com',
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

  /** Espera la siguiente solicitud a `url` y la responde. */
  async function respond(url: string, response: SimulatedResponse) {
    let pending = http.match((request) => request.url === url);
    for (let tick = 0; pending.length === 0 && tick < 20; tick++) {
      await new Promise((resolve) => setTimeout(resolve));
      pending = http.match((request) => request.url === url);
    }
    expect(pending.length).withContext('solicitudes pendientes').toBe(1);
    pending[0].flush(response.body as object, { status: response.status, statusText: 'simulado' });
    return pending[0];
  }

  it('reúne todas las páginas de los eventos propios para el selector', async () => {
    const events = gateway.loadOwnEvents();
    const first = await respond(MY_EVENTS_URL, MY_EVENTS_RESPONSES.firstPage);
    const second = await respond(MY_EVENTS_URL, MY_EVENTS_RESPONSES.lastPage);

    expect(first.request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
    expect(first.request.params.get('limit')).toBe('100');
    expect(first.request.params.has('status')).toBeFalse();
    expect(second.request.params.get('cursor')).toBe('cursor-sintetico-eventos-2');
    expect((await events).length).toBe(3);
  });

  it('CA1: pide la primera página con el filtro y el tamaño del contrato', async () => {
    const page = gateway.loadAttendees(ATTENDEES_EVENT.event_id, 'REGISTERED', null);
    const request = await respond(ATTENDEES_URL, EVENT_ATTENDEES_RESPONSES.firstPage);

    expect(request.request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
    expect(request.request.params.keys().sort()).toEqual(['limit', 'status']);
    expect(request.request.params.get('status')).toBe('REGISTERED');
    expect(request.request.params.get('limit')).toBe('20');
    expect((await page).total).toBe(23);
  });

  it('CA4: pide la página siguiente con el mismo filtro y el cursor sin modificar', async () => {
    const page = gateway.loadAttendees(ATTENDEES_EVENT.event_id, 'ALL', ATTENDEES_NEXT_CURSOR);
    const request = await respond(ATTENDEES_URL, EVENT_ATTENDEES_RESPONSES.lastPage);

    expect(request.request.params.get('status')).toBe('ALL');
    expect(request.request.params.get('cursor')).toBe(ATTENDEES_NEXT_CURSOR);
    expect((await page).nextCursor).toBeNull();
  });

  for (const [name, response] of [
    ['CA2: evento ajeno o inexistente', EVENT_ATTENDEES_RESPONSES.eventNotFound],
    ['CA4: cursor inválido', EVENT_ATTENDEES_RESPONSES.invalidCursor],
    ['permiso denegado', EVENT_ATTENDEES_RESPONSES.permissionRequired],
    ['servicio no disponible', EVENT_ATTENDEES_RESPONSES.upstreamUnavailable],
  ] as const) {
    it(`${name}: rechaza con el error original, nunca como lista vacía`, async () => {
      const page = gateway.loadAttendees(ATTENDEES_EVENT.event_id, 'REGISTERED', null);
      await respond(ATTENDEES_URL, response);

      await expectAsync(page).toBeRejectedWith(
        jasmine.objectContaining({
          status: response.status,
          error: jasmine.objectContaining({ code: response.body.code }),
        }),
      );
    });
  }

  it('401 invalid_access_token termina la sesión como vencida', async () => {
    const page = gateway.loadAttendees(ATTENDEES_EVENT.event_id, 'REGISTERED', null);
    await respond(ATTENDEES_URL, EVENT_ATTENDEES_RESPONSES.invalidAccessToken);

    await expectAsync(page).toBeRejected();
    expect(session.lastEndReason()).toBe('expired');
  });

  it('un fallo de los eventos propios rechaza y, con 401, termina la sesión', async () => {
    const events = gateway.loadOwnEvents();
    await respond(MY_EVENTS_URL, MY_EVENTS_RESPONSES.invalidAccessToken);

    await expectAsync(events).toBeRejectedWith(jasmine.any(HttpErrorResponse));
    expect(session.lastEndReason()).toBe('expired');
  });

  it('sin access token vigente no llama al BFF', async () => {
    session.end();

    await expectAsync(gateway.loadOwnEvents()).toBeRejected();
    await expectAsync(
      gateway.loadAttendees(ATTENDEES_EVENT.event_id, 'REGISTERED', null),
    ).toBeRejected();
    http.expectNone(MY_EVENTS_URL);
    http.expectNone(ATTENDEES_URL);
  });
});
