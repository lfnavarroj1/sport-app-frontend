import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import {
  EVENT_CONFLICTS_RESPONSES,
  OWN_DRAFT,
  PUBLISHED_EVENTS_RESPONSES,
  SIMULATED_CALENDAR_CURSOR,
} from '../../../../testing/bff-web/event-calendar.fixtures';
import { organizerEvent } from '../../../../testing/bff-web/publish-event.fixtures';
import { SimulatedResponse } from '../../../../testing/bff-web/register-user.fixtures';
import { APP_CONFIG, AppConfig } from '../../../core/config/app-config';
import { SessionStore } from '../../../core/session/session.store';
import { CalendarQuery } from './event-calendar.model';
import { HttpEventCalendarGateway } from './http-event-calendar.gateway';

const BFF = 'http://bff.example.com';
const TOKEN = 'token-sintetico';
const QUERY: CalendarQuery = {
  period: { from: '2027-03-01T05:00:00Z', to: '2027-04-01T05:00:00Z' },
  discipline: 'Running',
  city: null,
};

describe('HttpEventCalendarGateway (HU023, contrato bff-web 0.18.0)', () => {
  let http: HttpTestingController;
  let session: SessionStore;
  let gateway: HttpEventCalendarGateway;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        HttpEventCalendarGateway,
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
    gateway = TestBed.inject(HttpEventCalendarGateway);
    session.start({
      user: {
        id: OWN_DRAFT.organizer_id,
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

  function flush(url: string, response: SimulatedResponse): void {
    http
      .expectOne((r) => r.url === url)
      .flush(response.body as object, { status: response.status, statusText: 'simulado' });
  }

  it('consulta el periodo con los filtros indicados y el tamaño de página del contrato (CA1)', async () => {
    const page = gateway.loadEvents(QUERY, null);
    const request = http.expectOne((r) => r.url === `${BFF}/v1/events`);
    expect(request.request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
    expect(request.request.params.keys()).toEqual(['from', 'to', 'discipline', 'limit']);
    expect(request.request.params.get('limit')).toBe('200');
    request.flush(PUBLISHED_EVENTS_RESPONSES.firstPage.body);

    const result = await page;
    expect(result.events.length).toBe(2);
    expect(result.nextCursor).toBe(SIMULATED_CALENDAR_CURSOR);
  });

  it('pide la página siguiente con la misma consulta y el cursor sin modificar (CA4)', async () => {
    const page = gateway.loadEvents(QUERY, SIMULATED_CALENDAR_CURSOR);
    const request = http.expectOne((r) => r.url === `${BFF}/v1/events`);
    expect(request.request.params.get('cursor')).toBe(SIMULATED_CALENDAR_CURSOR);
    expect(request.request.params.get('discipline')).toBe('Running');
    request.flush(PUBLISHED_EVENTS_RESPONSES.lastPage.body);

    expect((await page).nextCursor).toBeNull();
  });

  it('un 422 se rechaza con el error original, nunca como calendario vacío (CA3)', async () => {
    const page = gateway.loadEvents(QUERY, null);
    flush(`${BFF}/v1/events`, PUBLISHED_EVENTS_RESPONSES.periodTooLong);

    await expectAsync(page).toBeRejectedWith(jasmine.objectContaining({ status: 422 }));
  });

  it('un token rechazado termina la sesión', async () => {
    const page = gateway.loadEvents(QUERY, null);
    flush(`${BFF}/v1/events`, PUBLISHED_EVENTS_RESPONSES.invalidAccessToken);

    await expectAsync(page).toBeRejected();
    expect(session.accessToken()).toBeNull();
  });

  it('sin sesión no llama al BFF', async () => {
    session.end();

    await expectAsync(gateway.loadEvents(QUERY, null)).toBeRejectedWith(
      jasmine.any(HttpErrorResponse),
    );
    http.expectNone((r) => r.url === `${BFF}/v1/events`);
  });

  it('carga todos los eventos propios recorriendo las páginas', async () => {
    const events = gateway.loadOwnEvents();
    const first = http.expectOne((r) => r.url === `${BFF}/v1/me/events`);
    expect(first.request.params.get('limit')).toBe('100');
    expect(first.request.params.has('status')).toBeFalse();
    first.flush({ items: [organizerEvent(0)], next_cursor: 'c2' });
    await Promise.resolve();
    const second = http.expectOne((r) => r.url === `${BFF}/v1/me/events`);
    expect(second.request.params.get('cursor')).toBe('c2');
    second.flush({ items: [organizerEvent(1, 'PUBLISHED')], next_cursor: null });

    expect((await events).map((event) => [event.name, event.status])).toEqual([
      ['Carrera 10K Bogotá', 'DRAFT'],
      ['Evento sintético 2', 'PUBLISHED'],
    ]);
  });

  it('un fallo de los eventos propios se rechaza con el error original', async () => {
    const events = gateway.loadOwnEvents();
    flush(`${BFF}/v1/me/events`, {
      status: 503,
      body: { code: 'upstream_unavailable', message: 'x', correlation_id: null, details: [] },
    });

    await expectAsync(events).toBeRejectedWith(jasmine.objectContaining({ status: 503 }));
  });

  it('consulta las coincidencias del evento propio (CA2)', async () => {
    const conflicts = gateway.loadConflicts(OWN_DRAFT.event_id);
    flush(`${BFF}/v1/me/events/${OWN_DRAFT.event_id}/conflicts`, EVENT_CONFLICTS_RESPONSES.found);

    expect((await conflicts).conflicts.length).toBe(2);
  });

  it('un evento ajeno se rechaza con el 404 original (CA2)', async () => {
    const conflicts = gateway.loadConflicts(OWN_DRAFT.event_id);
    flush(
      `${BFF}/v1/me/events/${OWN_DRAFT.event_id}/conflicts`,
      EVENT_CONFLICTS_RESPONSES.eventNotFound,
    );

    await expectAsync(conflicts).toBeRejectedWith(jasmine.objectContaining({ status: 404 }));
  });
});
