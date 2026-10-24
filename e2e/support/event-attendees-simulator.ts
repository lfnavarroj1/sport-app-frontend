import { Page, Request, Route } from '@playwright/test';

import {
  EVENT_ATTENDEES_RESPONSES,
  attendee,
  attendeesPage,
} from '../../src/testing/bff-web/event-attendees.fixtures';
import {
  MY_EVENTS_PATH,
  MY_EVENTS_RESPONSES,
  organizerEvent,
} from '../../src/testing/bff-web/publish-event.fixtures';
import { SimulatedResponse } from '../../src/testing/bff-web/register-user.fixtures';

type OrganizerEventDto = ReturnType<typeof organizerEvent>;
type AttendeeDto = ReturnType<typeof attendee>;

export interface EventAttendeesSimulation {
  /** Eventos propios del organizador, en el orden del backend. */
  events: OrganizerEventDto[];
  /** Inscripciones por `event_id`, en el orden del backend (`registered_at` asc). */
  readonly registrations: Map<string, AttendeeDto[]>;
  readonly eventsRequests: Request[];
  readonly attendeesRequests: Request[];
  /** Usuarios no responde: `display_name` nulo y la fuente `UNAVAILABLE` (CA6). */
  usersUnavailable: boolean;
  /** Respuestas de las próximas consultas de inscritos, en orden; luego, lo normal. */
  readonly next: SimulatedResponse[];
}

const ATTENDEES_PATH = /^\/v1\/me\/events\/([^/]+)\/registrations$/;
const DEFAULT_LIMIT = 20;

/**
 * Reemplaza `GET /v1/me/events` y `GET /v1/me/events/{event_id}/registrations`
 * con el simulador del contrato bff-web 0.22.0 y ADR-039. Como el BFF: sin
 * `Bearer` responde `401`; un evento que no es del organizador responde
 * `404 event_not_found`; `status` es `REGISTERED` por defecto o `ALL`; `limit`
 * por defecto 20; el cursor es la posición siguiente y uno que no es del
 * simulador responde `422 invalid_cursor`. `total` cuenta el filtro y
 * `by_status` todo el evento. Los eventos propios llegan en una sola página.
 */
export async function simulateEventAttendees(
  page: Page,
  events: OrganizerEventDto[],
  registrations: Record<string, AttendeeDto[]> = {},
): Promise<EventAttendeesSimulation> {
  const simulation: EventAttendeesSimulation = {
    events,
    registrations: new Map(Object.entries(registrations)),
    eventsRequests: [],
    attendeesRequests: [],
    usersUnavailable: false,
    next: [],
  };

  const authorized = async (route: Route) =>
    /^Bearer \S+$/.test((await route.request().headerValue('authorization')) ?? '');

  await page.route(
    (url) => url.pathname === MY_EVENTS_PATH,
    async (route) => {
      if (route.request().method() !== 'GET') {
        return route.fallback();
      }
      simulation.eventsRequests.push(route.request());
      await fulfill(
        route,
        (await authorized(route))
          ? { status: 200, body: { items: simulation.events, next_cursor: null } }
          : MY_EVENTS_RESPONSES.invalidAccessToken,
      );
    },
  );

  await page.route(
    (url) => ATTENDEES_PATH.test(url.pathname),
    async (route) => {
      if (route.request().method() !== 'GET') {
        return route.fallback();
      }
      simulation.attendeesRequests.push(route.request());
      if (!(await authorized(route))) {
        return fulfill(route, EVENT_ATTENDEES_RESPONSES.invalidAccessToken);
      }
      const queued = simulation.next.shift();
      if (queued) {
        return fulfill(route, queued);
      }
      const url = new URL(route.request().url());
      const eventId = decodeURIComponent(ATTENDEES_PATH.exec(url.pathname)![1]);
      if (!simulation.events.some((event) => event.event_id === eventId)) {
        return fulfill(route, EVENT_ATTENDEES_RESPONSES.eventNotFound);
      }
      const all = simulation.registrations.get(eventId) ?? [];
      // En 0.22.0 todas las inscripciones están `REGISTERED`: `ALL` y `REGISTERED` coinciden.
      const filtered = all.filter(
        (item) =>
          (url.searchParams.get('status') ?? 'REGISTERED') === 'ALL' ||
          item.status === 'REGISTERED',
      );
      const limit = Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT);
      const cursor = url.searchParams.get('cursor');
      const start = cursor === null ? 0 : position(cursor);
      if (start === null) {
        return fulfill(route, EVENT_ATTENDEES_RESPONSES.invalidCursor);
      }
      const end = start + limit;
      const items = filtered
        .slice(start, end)
        .map((item) => (simulation.usersUnavailable ? { ...item, display_name: null } : item));
      await fulfill(route, {
        status: 200,
        body: attendeesPage(
          items,
          filtered.length,
          end < filtered.length ? `inscritos-desde-${end}` : null,
          !simulation.usersUnavailable,
          all.filter((item) => item.status === 'REGISTERED').length,
        ),
      });
    },
  );

  return simulation;
}

function position(cursor: string): number | null {
  const match = /^inscritos-desde-(\d+)$/.exec(cursor);
  return match ? Number(match[1]) : null;
}

async function fulfill(route: Route, response: SimulatedResponse): Promise<void> {
  const origin = (await route.request().headerValue('origin')) ?? '';
  await route.fulfill({
    status: response.status,
    json: response.body,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      'Cache-Control': 'no-store',
    },
  });
}
