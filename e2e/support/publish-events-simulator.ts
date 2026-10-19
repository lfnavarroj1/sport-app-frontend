import { Page, Request, Route } from '@playwright/test';

import {
  EVENT_DETAIL_RESPONSES,
  MY_EVENTS_PATH,
  MY_EVENTS_RESPONSES,
  PUBLISH_EVENT_RESPONSES,
  eventDetail,
  organizerEvent,
} from '../../src/testing/bff-web/publish-event.fixtures';
import { SimulatedResponse } from '../../src/testing/bff-web/register-user.fixtures';

type OrganizerEventDto = ReturnType<typeof organizerEvent>;

export interface PublishEventsSimulation {
  /** Eventos propios del organizador, en el orden del contrato (`starts_at` asc). */
  events: OrganizerEventDto[];
  readonly listRequests: Request[];
  readonly detailRequests: Request[];
  readonly publishRequests: Request[];
  /** Respuestas de las próximas publicaciones, en orden; luego, el comportamiento normal. */
  readonly nextPublish: SimulatedResponse[];
  /** La lista sigue mostrando el estado anterior hasta que se proyecte (lectura eventual). */
  projectionDelayed: boolean;
}

const DETAIL_PATH = /^\/v1\/events\/([^/]+)$/;
const PUBLISH_PATH = /^\/v1\/events\/([^/]+)\/publish$/;

/**
 * Reemplaza `GET /v1/me/events`, `GET /v1/events/{event_id}` y
 * `POST /v1/events/{event_id}/publish` con el simulador del contrato bff-web
 * 0.16.0 y ADR-033. Como el BFF: sin `Bearer` responde `401`; la lista filtra por
 * estado y pagina con un cursor opaco; un evento desconocido responde `404`.
 * Publicar un borrador con inicio futuro lo pasa a `PUBLISHED` con versión + 1;
 * con inicio pasado responde `422 not_in_future`; ya publicado responde `200`
 * con su estado. La misma clave con el mismo evento repite la respuesta con
 * `Idempotent-Replayed: true`, y con otro evento responde `409`.
 */
export async function simulatePublishEvents(
  page: Page,
  events: OrganizerEventDto[] = [],
): Promise<PublishEventsSimulation> {
  const simulation: PublishEventsSimulation = {
    events,
    listRequests: [],
    detailRequests: [],
    publishRequests: [],
    nextPublish: [],
    projectionDelayed: false,
  };
  const byKey = new Map<string, { eventId: string; body: unknown }>();
  /** Estado que ya proyectó la lectura, por evento. */
  const projected = new Map<string, OrganizerEventDto>();

  const authorized = async (route: Route) =>
    /^Bearer \S+$/.test((await route.request().headerValue('authorization')) ?? '');

  await page.route(
    (url) => url.pathname === MY_EVENTS_PATH,
    async (route) => {
      if (route.request().method() !== 'GET') {
        return route.fallback();
      }
      simulation.listRequests.push(route.request());
      if (!(await authorized(route))) {
        return fulfill(route, MY_EVENTS_RESPONSES.invalidAccessToken);
      }
      const query = new URL(route.request().url()).searchParams;
      const visible = simulation.events.map((event) =>
        simulation.projectionDelayed ? (projected.get(event.event_id) ?? event) : event,
      );
      const matches = visible.filter(
        (event) => !query.get('status') || event.status === query.get('status'),
      );
      const limit = Number(query.get('limit') ?? 20);
      const offset = query.get('cursor') ? Number(atob(query.get('cursor')!).split(':')[1]) : 0;
      const more = offset + limit < matches.length;
      await fulfill(route, {
        status: 200,
        body: {
          items: matches.slice(offset, offset + limit),
          next_cursor: more ? btoa(`offset:${offset + limit}`) : null,
        },
      });
    },
  );

  await page.route(
    (url) => DETAIL_PATH.test(url.pathname),
    async (route) => {
      if (route.request().method() !== 'GET') {
        return route.fallback();
      }
      simulation.detailRequests.push(route.request());
      if (!(await authorized(route))) {
        return fulfill(route, EVENT_DETAIL_RESPONSES.invalidAccessToken);
      }
      const id = DETAIL_PATH.exec(new URL(route.request().url()).pathname)![1];
      const event = simulation.events.find((item) => item.event_id === id);
      await fulfill(
        route,
        event ? { status: 200, body: eventDetail(event) } : EVENT_DETAIL_RESPONSES.eventNotFound,
      );
    },
  );

  await page.route(
    (url) => PUBLISH_PATH.test(url.pathname),
    async (route) => {
      if (route.request().method() !== 'POST') {
        return route.fallback();
      }
      simulation.publishRequests.push(route.request());
      if (!(await authorized(route))) {
        return fulfill(route, PUBLISH_EVENT_RESPONSES.invalidAccessToken);
      }
      const queued = simulation.nextPublish.shift();
      if (queued) {
        return fulfill(route, queued);
      }
      const id = PUBLISH_PATH.exec(new URL(route.request().url()).pathname)![1];
      const key = (await route.request().headerValue('idempotency-key')) ?? '';
      const previous = byKey.get(key);
      if (previous) {
        return previous.eventId === id
          ? fulfill(route, { status: 200, body: previous.body }, { 'Idempotent-Replayed': 'true' })
          : fulfill(route, PUBLISH_EVENT_RESPONSES.idempotencyKeyReused);
      }
      const index = simulation.events.findIndex((item) => item.event_id === id);
      if (index < 0) {
        return fulfill(route, PUBLISH_EVENT_RESPONSES.eventNotFound);
      }
      const event = simulation.events[index];
      if (event.status === 'DRAFT' && new Date(event.starts_at).getTime() <= Date.now()) {
        return fulfill(route, PUBLISH_EVENT_RESPONSES.notInFuture);
      }
      const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
      const result: OrganizerEventDto =
        event.status === 'PUBLISHED'
          ? event
          : {
              ...event,
              status: 'PUBLISHED',
              version: event.version + 1,
              updated_at: now,
              published_at: now,
            };
      projected.set(id, event);
      simulation.events[index] = result;
      byKey.set(key, { eventId: id, body: result });
      await fulfill(route, { status: 200, body: result });
    },
  );

  return simulation;
}

/** CORS como el BFF: origen explícito y cabeceras del comando expuestas. */
async function fulfill(
  route: Route,
  response: SimulatedResponse,
  headers: Record<string, string> = {},
): Promise<void> {
  const origin = (await route.request().headerValue('origin')) ?? '';
  await route.fulfill({
    status: response.status,
    json: response.body,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Expose-Headers': 'Idempotent-Replayed, X-Correlation-ID',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}
