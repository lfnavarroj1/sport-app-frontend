import { Page, Request, Route } from '@playwright/test';

import {
  EVENT_CONFLICTS_RESPONSES,
  MARCH_EVENTS,
  OWN_DRAFT,
  PUBLISHED_EVENTS_PATH,
  PUBLISHED_EVENTS_RESPONSES,
  calendarEvents,
} from '../../src/testing/bff-web/event-calendar.fixtures';
import { MY_EVENTS_PATH, organizerEvent } from '../../src/testing/bff-web/publish-event.fixtures';
import { SimulatedResponse } from '../../src/testing/bff-web/register-user.fixtures';

type PublishedEventDto = ReturnType<typeof calendarEvents>[number];
type OrganizerEventDto = ReturnType<typeof organizerEvent>;

export interface EventCalendarSimulation {
  /** Publicados de todos los organizadores, en el orden del contrato (`starts_at`, `event_id`). */
  published: PublishedEventDto[];
  /** Eventos propios del organizador de la sesión. */
  own: OrganizerEventDto[];
  readonly calendarRequests: Request[];
  readonly conflictRequests: Request[];
  /** Respuesta de la próxima consulta del calendario; luego, el comportamiento normal. */
  nextCalendar: SimulatedResponse | null;
  /** Eventos por página de `GET /v1/events`. */
  pageSize: number;
}

const CONFLICTS_PATH = /^\/v1\/me\/events\/([^/]+)\/conflicts$/;
const MAX_PERIOD_MS = 92 * 86_400_000;

/** Igualdad del backend: sin mayúsculas ni acentos, sobre el texto recortado (ADR-040). */
function normalize(value: string): string {
  return value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function invalid(field: string, issue: string): SimulatedResponse {
  return {
    status: 422,
    body: {
      ...PUBLISHED_EVENTS_RESPONSES.periodTooLong.body,
      details: [{ field: `query.${field}`, issue }],
    },
  };
}

/**
 * Reemplaza `GET /v1/events`, `GET /v1/me/events` y
 * `GET /v1/me/events/{event_id}/conflicts` con el simulador del contrato bff-web
 * 0.18.0 y ADR-040. Como el BFF: sin `Bearer` responde `401`; el calendario
 * devuelve los publicados que se solapan con `[from, to)`, filtra por disciplina
 * y ciudad sin mayúsculas ni acentos, pagina con un cursor opaco y responde `422`
 * si el periodo está invertido, supera 92 días o un filtro tiene menos de 2
 * caracteres. Las coincidencias del borrador de ADR-033 son las del simulador;
 * un evento ajeno responde `404 event_not_found`.
 */
export async function simulateEventCalendar(page: Page): Promise<EventCalendarSimulation> {
  const simulation: EventCalendarSimulation = {
    published: [...MARCH_EVENTS],
    own: [OWN_DRAFT],
    calendarRequests: [],
    conflictRequests: [],
    nextCalendar: null,
    pageSize: 200,
  };

  const unauthenticated = async (route: Route): Promise<boolean> =>
    !/^Bearer \S+$/.test((await route.request().headerValue('authorization')) ?? '');

  await page.route(
    (url) => url.pathname === PUBLISHED_EVENTS_PATH,
    async (route) => {
      if (route.request().method() !== 'GET') {
        return route.fallback();
      }
      simulation.calendarRequests.push(route.request());
      if (await unauthenticated(route)) {
        return fulfill(route, PUBLISHED_EVENTS_RESPONSES.invalidAccessToken);
      }
      const forced = simulation.nextCalendar;
      simulation.nextCalendar = null;
      if (forced) {
        return fulfill(route, forced);
      }
      const params = new URL(route.request().url()).searchParams;
      const from = Date.parse(params.get('from') ?? '');
      const to = Date.parse(params.get('to') ?? '');
      if (Number.isNaN(from) || Number.isNaN(to)) {
        return fulfill(route, invalid('from', 'invalid_datetime'));
      }
      if (to <= from) {
        return fulfill(route, invalid('to', 'ends_before_starts'));
      }
      if (to - from > MAX_PERIOD_MS) {
        return fulfill(route, invalid('to', 'out_of_range'));
      }
      const discipline = params.get('discipline');
      const city = params.get('city');
      for (const [name, value] of [
        ['discipline', discipline],
        ['city', city],
      ] as const) {
        if (value !== null && (value.trim().length < 2 || value.trim().length > 80)) {
          return fulfill(route, invalid(name, 'invalid_length'));
        }
      }
      const matching = simulation.published.filter(
        (event) =>
          Date.parse(event.starts_at) < to &&
          Date.parse(event.ends_at) > from &&
          (discipline === null || normalize(event.discipline) === normalize(discipline)) &&
          (city === null || normalize(event.location.city) === normalize(city)),
      );
      // Cursor opaco con caracteres que una codificación laxa alteraría.
      const cursor = params.get('cursor');
      const offset = cursor === null ? 0 : Number(/^p\+(\d+)\/=$/.exec(cursor)?.[1] ?? NaN);
      if (Number.isNaN(offset)) {
        return fulfill(route, invalid('cursor', 'invalid_cursor'));
      }
      const next = offset + simulation.pageSize;
      await fulfill(route, {
        status: 200,
        body: {
          items: matching.slice(offset, next),
          next_cursor: next < matching.length ? `p+${next}/=` : null,
        },
      });
    },
  );

  await page.route(
    (url) => url.pathname === MY_EVENTS_PATH,
    async (route) => {
      if (route.request().method() !== 'GET') {
        return route.fallback();
      }
      if (await unauthenticated(route)) {
        return fulfill(route, PUBLISHED_EVENTS_RESPONSES.invalidAccessToken);
      }
      await fulfill(route, { status: 200, body: { items: simulation.own, next_cursor: null } });
    },
  );

  await page.route(
    (url) => CONFLICTS_PATH.test(url.pathname),
    async (route) => {
      simulation.conflictRequests.push(route.request());
      if (await unauthenticated(route)) {
        return fulfill(route, EVENT_CONFLICTS_RESPONSES.invalidAccessToken);
      }
      const eventId = CONFLICTS_PATH.exec(new URL(route.request().url()).pathname)?.[1];
      const own = simulation.own.some((event) => event.event_id === eventId);
      await fulfill(
        route,
        !own
          ? EVENT_CONFLICTS_RESPONSES.eventNotFound
          : eventId === OWN_DRAFT.event_id
            ? EVENT_CONFLICTS_RESPONSES.found
            : EVENT_CONFLICTS_RESPONSES.none,
      );
    },
  );

  return simulation;
}

/** CORS como el BFF: origen explícito y credenciales. */
async function fulfill(route: Route, response: SimulatedResponse): Promise<void> {
  const origin = (await route.request().headerValue('origin')) ?? '';
  await route.fulfill({
    status: response.status,
    ...(response.body === null ? { body: '' } : { json: response.body }),
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Expose-Headers': 'X-Correlation-ID',
      'Cache-Control': 'no-store',
    },
  });
}
