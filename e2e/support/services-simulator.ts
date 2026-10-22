import { Page, Request, Route } from '@playwright/test';

import {
  CREATE_SERVICE_PATH,
  CREATE_SERVICE_RESPONSES,
  CREATED_SERVICE,
} from '../../src/testing/bff-web/create-service.fixtures';
import { SimulatedResponse } from '../../src/testing/bff-web/register-user.fixtures';

export interface ServicesSimulation {
  /** Solicitudes recibidas en `POST /v1/services`. */
  readonly requests: Request[];
  /** Respuestas de las próximas solicitudes, en orden; luego, el comportamiento normal. */
  readonly next: SimulatedResponse[];
}

/**
 * Reemplaza `POST /v1/services` con el simulador del contrato bff-web 0.16.0 y
 * ADR-027. Como el BFF: sin `Bearer` responde `401`; la misma `Idempotency-Key`
 * con el mismo cuerpo devuelve el mismo borrador con `Idempotent-Replayed: true`
 * y con otro cuerpo responde `409 idempotency_key_reused`. El borrador devuelto
 * conserva lo enviado, con los instantes de cada intervalo en UTC.
 */
export async function simulateServices(page: Page): Promise<ServicesSimulation> {
  const simulation: ServicesSimulation = { requests: [], next: [] };
  const byKey = new Map<string, { body: string; service: object }>();

  await page.route(`**${CREATE_SERVICE_PATH}`, async (route) => {
    if (route.request().method() !== 'POST') {
      return route.fallback();
    }
    simulation.requests.push(route.request());
    const authorization = (await route.request().headerValue('authorization')) ?? '';
    if (!/^Bearer \S+$/.test(authorization)) {
      return fulfill(route, CREATE_SERVICE_RESPONSES.invalidAccessToken);
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
        ? fulfill(route, { status: 201, body: previous.service }, { 'Idempotent-Replayed': 'true' })
        : fulfill(route, CREATE_SERVICE_RESPONSES.idempotencyKeyReused);
    }
    const request = JSON.parse(body) as Record<string, unknown>;
    const utc = (iso: string) => new Date(iso).toISOString().replace('.000Z', 'Z');
    const intervals = (request['availability'] ?? []) as Record<string, unknown>[];
    const service = {
      ...CREATED_SERVICE,
      ...request,
      availability: intervals.map((interval) => ({
        ...interval,
        starts_at: utc(interval['starts_at'] as string),
        ends_at: utc(interval['ends_at'] as string),
      })),
    };
    byKey.set(key, { body, service });
    await fulfill(route, { status: 201, body: service });
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
      ...(response.status === 201
        ? { Location: `/v1/services/${CREATED_SERVICE.service_id}` }
        : {}),
      ...headers,
    },
  });
}
