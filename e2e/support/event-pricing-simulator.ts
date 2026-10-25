import { Page, Request, Route } from '@playwright/test';

import {
  DELETE_EVENT_FEE_RESPONSES,
  PUT_EVENT_FEE_RESPONSES,
} from '../../src/testing/bff-web/event-pricing.fixtures';
import { MY_EVENTS_PATH, organizerEvent } from '../../src/testing/bff-web/publish-event.fixtures';
import { SimulatedResponse } from '../../src/testing/bff-web/register-user.fixtures';

type OwnEventDto = ReturnType<typeof organizerEvent>;

export interface EventPricingSimulation {
  /** Eventos propios del organizador (estado de escritura), en el orden del contrato. */
  events: OwnEventDto[];
  readonly listRequests: Request[];
  readonly feeRequests: Request[];
  /** Respuestas de los próximos comandos de tarifa, en orden; luego, el comportamiento normal. */
  readonly nextFee: SimulatedResponse[];
}

const FEE_PATH = /^\/v1\/events\/([^/]+)\/fee$/;
const AMOUNT = /^[0-9]+\.[0-9]{2}$/;

/**
 * Reemplaza `GET /v1/me/events` y `PUT`/`DELETE /v1/events/{event_id}/fee` con
 * el simulador del contrato bff-web 0.26.0 y ADR-040. Como el BFF: sin `Bearer`
 * responde `401`; un evento desconocido, `404 event_not_found`; una versión
 * distinta, `409 version_conflict` con la vigente; un importe fuera del patrón o
 * del rango, otra moneda o un evento iniciado, `422 validation_error`. Un cambio
 * aceptado sube la versión y conserva `registration_count`. La misma clave con
 * el mismo cuerpo repite la respuesta con `Idempotent-Replayed: true`; con otro
 * cuerpo responde `409 idempotency_key_reused`.
 */
export async function simulateEventPricing(
  page: Page,
  events: OwnEventDto[] = [],
): Promise<EventPricingSimulation> {
  const simulation: EventPricingSimulation = {
    events,
    listRequests: [],
    feeRequests: [],
    nextFee: [],
  };
  const byKey = new Map<string, { request: string; body: unknown }>();

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
        return fulfill(route, PUT_EVENT_FEE_RESPONSES.invalidAccessToken);
      }
      const query = new URL(route.request().url()).searchParams;
      const limit = Number(query.get('limit') ?? 20);
      const offset = query.get('cursor') ? Number(atob(query.get('cursor')!).split(':')[1]) : 0;
      const more = offset + limit < simulation.events.length;
      await fulfill(route, {
        status: 200,
        body: {
          items: simulation.events.slice(offset, offset + limit),
          next_cursor: more ? btoa(`offset:${offset + limit}`) : null,
        },
      });
    },
  );

  await page.route(
    (url) => FEE_PATH.test(url.pathname),
    async (route) => {
      const method = route.request().method();
      if (method !== 'PUT' && method !== 'DELETE') {
        return route.fallback();
      }
      simulation.feeRequests.push(route.request());
      if (!(await authorized(route))) {
        return fulfill(route, PUT_EVENT_FEE_RESPONSES.invalidAccessToken);
      }
      const queued = simulation.nextFee.shift();
      if (queued) {
        return fulfill(route, queued);
      }
      const url = new URL(route.request().url());
      const id = decodeURIComponent(FEE_PATH.exec(url.pathname)![1]);
      const body =
        method === 'PUT'
          ? (route.request().postDataJSON() as {
              amount: string;
              currency: string;
              expected_version: number;
            })
          : null;
      const expected = body?.expected_version ?? Number(url.searchParams.get('expected_version'));
      const signature = `${method} ${id} ${JSON.stringify(body)} ${expected}`;
      const key = (await route.request().headerValue('idempotency-key')) ?? '';
      const previous = byKey.get(key);
      if (previous) {
        return previous.request === signature
          ? fulfill(route, { status: 200, body: previous.body }, { 'Idempotent-Replayed': 'true' })
          : fulfill(route, PUT_EVENT_FEE_RESPONSES.idempotencyKeyReused);
      }
      const index = simulation.events.findIndex((item) => item.event_id === id);
      if (index < 0) {
        return fulfill(route, PUT_EVENT_FEE_RESPONSES.eventNotFound);
      }
      const event = simulation.events[index];
      if (expected !== event.version) {
        return fulfill(route, {
          status: 409,
          body: {
            ...PUT_EVENT_FEE_RESPONSES.versionConflict.body,
            details: [{ field: 'expected_version', issue: String(event.version) }],
          },
        });
      }
      if (body && (!AMOUNT.test(body.amount) || Number(body.amount) > 99_999_999.99)) {
        return fulfill(route, PUT_EVENT_FEE_RESPONSES.outOfRange);
      }
      if (body && body.currency !== 'COP') {
        return fulfill(route, PUT_EVENT_FEE_RESPONSES.unsupportedCurrency);
      }
      if (new Date(event.starts_at).getTime() <= Date.now()) {
        return fulfill(
          route,
          method === 'PUT'
            ? PUT_EVENT_FEE_RESPONSES.eventAlreadyStarted
            : DELETE_EVENT_FEE_RESPONSES.eventAlreadyStarted,
        );
      }
      const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
      const result: OwnEventDto = {
        ...event,
        version: event.version + 1,
        updated_at: now,
        fee: body ? { amount: body.amount, currency: 'COP' } : null,
        fee_updated_at: now,
      };
      simulation.events[index] = result;
      byKey.set(key, { request: signature, body: result });
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
      'Access-Control-Allow-Methods': 'GET, PUT, DELETE',
      'Access-Control-Expose-Headers': 'Idempotent-Replayed, X-Correlation-ID',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}
