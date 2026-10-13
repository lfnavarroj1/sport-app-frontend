import { Page, Request, Route } from '@playwright/test';

import {
  CREATE_EVENT_PATH,
  CREATE_EVENT_RESPONSES,
  CREATED_EVENT,
} from '../../src/testing/bff-web/create-event.fixtures';
import { SimulatedResponse } from '../../src/testing/bff-web/register-user.fixtures';

export interface EventsSimulation {
  /** Solicitudes recibidas en `POST /v1/events`. */
  readonly requests: Request[];
  /** Respuestas de las próximas solicitudes, en orden; luego, el comportamiento normal. */
  readonly next: SimulatedResponse[];
}

/**
 * Reemplaza `POST /v1/events` con el simulador del contrato bff-web 0.10.0 y
 * ADR-028. Como el BFF: sin `Bearer` responde `401`; la misma `Idempotency-Key`
 * con el mismo cuerpo devuelve el mismo borrador con `Idempotent-Replayed: true`
 * y con otro cuerpo responde `409 idempotency_key_reused`. El borrador devuelto
 * conserva lo enviado, con los instantes en UTC y `ends_at` calculado.
 */
export async function simulateEvents(page: Page): Promise<EventsSimulation> {
  const simulation: EventsSimulation = { requests: [], next: [] };
  const byKey = new Map<string, { body: string; event: object }>();

  await page.route(`**${CREATE_EVENT_PATH}`, async (route) => {
    if (route.request().method() !== 'POST') {
      return route.fallback();
    }
    simulation.requests.push(route.request());
    const authorization = (await route.request().headerValue('authorization')) ?? '';
    if (!/^Bearer \S+$/.test(authorization)) {
      return fulfill(route, CREATE_EVENT_RESPONSES.invalidAccessToken);
    }
    const queued = simulation.next.shift();
    if (queued) {
      return fulfill(route, queued);
    }
    const key = (await route.request().headerValue('idempotency-key')) ?? '';
    const body = route.request().postData() ?? '';
    const previous = byKey.get(key);
    if (previous) {
      return previous.body === body
        ? fulfill(route, { status: 201, body: previous.event }, { 'Idempotent-Replayed': 'true' })
        : fulfill(route, CREATE_EVENT_RESPONSES.idempotencyKeyReused);
    }
    const request = JSON.parse(body) as Record<string, unknown>;
    const starts = new Date(request['starts_at'] as string);
    const utc = (date: Date) => date.toISOString().replace('.000Z', 'Z');
    const event = {
      ...CREATED_EVENT,
      ...request,
      starts_at: utc(starts),
      ends_at: utc(new Date(starts.getTime() + (request['duration_minutes'] as number) * 60_000)),
    };
    byKey.set(key, { body, event });
    await fulfill(route, { status: 201, body: event });
  });

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
      'Access-Control-Expose-Headers': 'Location, Idempotent-Replayed, X-Correlation-ID',
      'Cache-Control': 'no-store',
      ...(response.status === 201 ? { Location: `/v1/events/${CREATED_EVENT.event_id}` } : {}),
      ...headers,
    },
  });
}
