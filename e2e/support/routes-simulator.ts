import { Page, Request, Route } from '@playwright/test';

import { SimulatedResponse } from '../../src/testing/bff-web/register-user.fixtures';
import {
  MY_ROUTES_PATH,
  MY_ROUTES_RESPONSES,
  PUBLISH_ROUTE_RESPONSES,
  RETIRE_ROUTE_RESPONSES,
  ROUTES_PATH,
  SIMULATED_ROUTES_ORGANIZER_ID,
  organizerRoute,
} from '../../src/testing/bff-web/routes.fixtures';

type RouteDto = ReturnType<typeof organizerRoute>;
interface Detail {
  readonly field: string;
  readonly issue: string;
}

export interface RoutesSimulation {
  /** Rutas del organizador, de la más reciente a la más antigua (orden del contrato). */
  routes: RouteDto[];
  readonly listRequests: Request[];
  readonly publishRequests: Request[];
  readonly retireRequests: Request[];
  /** Respuestas de las próximas publicaciones, en orden; luego, lo normal. */
  readonly nextPublish: SimulatedResponse[];
}

const RETIRE_PATH = /^\/v1\/routes\/([^/]+)\/retire$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_LIMIT = 20;

/**
 * Reemplaza `POST /v1/routes`, `POST /v1/routes/{route_id}/retire` y
 * `GET /v1/me/routes` con el simulador del contrato bff-web 0.23.0 y ADR-041.
 * Como el BFF: sin `Bearer` responde `401`; publicar exige `Idempotency-Key`
 * UUID y la misma clave con el mismo cuerpo repite la respuesta con
 * `Idempotent-Replayed: true` (con otro cuerpo, `409 idempotency_key_reused`);
 * las reglas del servicio responden `422` con `body.<campo>` (nombre 3–120,
 * distancia 0.1–500.0 con un decimal, latitud y longitud en rango); la ruta nace
 * `PUBLISHED` en versión 1. Retirar exige la versión vigente (`409
 * version_conflict` con la vigente), una ruta ajena responde `404` y una ya
 * retirada se devuelve tal cual. La lista pagina de 20 en 20.
 */
export async function simulateRoutes(
  page: Page,
  routes: RouteDto[] = [],
): Promise<RoutesSimulation> {
  const simulation: RoutesSimulation = {
    routes,
    listRequests: [],
    publishRequests: [],
    retireRequests: [],
    nextPublish: [],
  };
  const replays = new Map<string, { body: string; response: SimulatedResponse }>();
  let clock = Date.parse('2026-10-24T16:00:00Z');
  const now = () => new Date((clock += 60_000)).toISOString().replace('.000Z', 'Z');

  const authorized = async (route: Route) =>
    /^Bearer \S+$/.test((await route.request().headerValue('authorization')) ?? '');

  await page.route(
    (url) => url.pathname === MY_ROUTES_PATH,
    async (route) => {
      if (route.request().method() !== 'GET') {
        return route.fallback();
      }
      simulation.listRequests.push(route.request());
      if (!(await authorized(route))) {
        return fulfill(route, MY_ROUTES_RESPONSES.invalidAccessToken);
      }
      const url = new URL(route.request().url());
      const limit = Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT);
      const cursor = url.searchParams.get('cursor');
      const start = cursor === null ? 0 : position(cursor);
      if (start === null) {
        return fulfill(route, MY_ROUTES_RESPONSES.invalidCursor);
      }
      const end = start + limit;
      await fulfill(route, {
        status: 200,
        body: {
          items: simulation.routes.slice(start, end),
          next_cursor: end < simulation.routes.length ? `rutas-desde-${end}` : null,
        },
      });
    },
  );

  await page.route(
    (url) => url.pathname === ROUTES_PATH,
    async (route) => {
      if (route.request().method() !== 'POST') {
        return route.fallback();
      }
      simulation.publishRequests.push(route.request());
      if (!(await authorized(route))) {
        return fulfill(route, PUBLISH_ROUTE_RESPONSES.invalidAccessToken);
      }
      const queued = simulation.nextPublish.shift();
      if (queued) {
        return fulfill(route, queued);
      }
      const key = (await route.request().headerValue('idempotency-key')) ?? '';
      if (!UUID.test(key)) {
        return fulfill(
          route,
          withDetails(PUBLISH_ROUTE_RESPONSES.validationError, [
            { field: 'Idempotency-Key', issue: 'required' },
          ]),
        );
      }
      const body = route.request().postData() ?? '';
      const previous = replays.get(key);
      if (previous) {
        return previous.body === body
          ? fulfill(route, previous.response, { 'Idempotent-Replayed': 'true' })
          : fulfill(route, PUBLISH_ROUTE_RESPONSES.idempotencyKeyReused);
      }
      const request = JSON.parse(body) as Record<string, unknown>;
      const violations = rejected(request);
      if (violations.length > 0) {
        return fulfill(route, withDetails(PUBLISH_ROUTE_RESPONSES.validationError, violations));
      }
      const instant = now();
      const created: RouteDto = {
        ...organizerRoute(0),
        route_id: crypto.randomUUID(),
        organizer_id: SIMULATED_ROUTES_ORGANIZER_ID,
        ...(request as Partial<RouteDto>),
        description: (request['description'] as string | null | undefined) || null,
        distance_km: oneDecimal(request['distance_km'] as string),
        waypoints: (request['waypoints'] as RouteDto['waypoints'] | undefined) ?? [],
        status: 'PUBLISHED',
        version: 1,
        created_at: instant,
        updated_at: instant,
        published_at: instant,
        retired_at: null,
      };
      simulation.routes = [created, ...simulation.routes];
      const response = { status: 201, body: created };
      replays.set(key, { body, response });
      await fulfill(route, response, { 'Idempotent-Replayed': 'false' });
    },
  );

  await page.route(
    (url) => RETIRE_PATH.test(url.pathname),
    async (route) => {
      if (route.request().method() !== 'POST') {
        return route.fallback();
      }
      simulation.retireRequests.push(route.request());
      if (!(await authorized(route))) {
        return fulfill(route, RETIRE_ROUTE_RESPONSES.invalidAccessToken);
      }
      const id = decodeURIComponent(RETIRE_PATH.exec(new URL(route.request().url()).pathname)![1]);
      const current = simulation.routes.find((item) => item.route_id === id);
      if (!current) {
        return fulfill(route, RETIRE_ROUTE_RESPONSES.routeNotFound);
      }
      if (current.status === 'RETIRED') {
        return fulfill(route, { status: 200, body: current });
      }
      const expected = (route.request().postDataJSON() as { expected_version?: number })
        .expected_version;
      if (expected !== current.version) {
        return fulfill(
          route,
          withDetails(RETIRE_ROUTE_RESPONSES.versionConflict, [
            { field: 'expected_version', issue: String(current.version) },
          ]),
        );
      }
      const instant = now();
      const retired: RouteDto = {
        ...current,
        status: 'RETIRED',
        version: current.version + 1,
        updated_at: instant,
        retired_at: instant,
      };
      simulation.routes = simulation.routes.map((item) => (item.route_id === id ? retired : item));
      await fulfill(route, { status: 200, body: retired });
    },
  );

  return simulation;
}

/** Reglas del servicio que el simulador reproduce (ADR-041), con el prefijo `body.`. */
function rejected(request: Record<string, unknown>): Detail[] {
  const details: Detail[] = [];
  const name = String(request['name'] ?? '').trim();
  if (name.length < 3 || name.length > 120) {
    details.push({ field: 'body.name', issue: 'invalid_length' });
  }
  const match = /^(\d+)(?:\.(\d))?$/.exec(String(request['distance_km'] ?? ''));
  const tenths = match ? Number(match[1]) * 10 + Number(match[2] ?? '0') : null;
  if (tenths === null || tenths < 1 || tenths > 5000) {
    details.push({ field: 'body.distance_km', issue: 'out_of_range' });
  }
  const points: [string, { lat?: number; lng?: number } | undefined][] = [
    ['start_point', request['start_point'] as { lat?: number; lng?: number } | undefined],
    ...((request['waypoints'] as { lat?: number; lng?: number }[] | undefined) ?? []).map(
      (point, index) => [`waypoints[${index}]`, point] as [string, { lat?: number; lng?: number }],
    ),
  ];
  for (const [field, point] of points) {
    if (point?.lat === undefined || Math.abs(point.lat) > 90) {
      details.push({ field: `body.${field}.lat`, issue: 'out_of_range' });
    }
    if (point?.lng === undefined || Math.abs(point.lng) > 180) {
      details.push({ field: `body.${field}.lng`, issue: 'out_of_range' });
    }
  }
  return details;
}

function oneDecimal(text: string): string {
  return text.includes('.') ? text : `${text}.0`;
}

function position(cursor: string): number | null {
  const match = /^rutas-desde-(\d+)$/.exec(cursor);
  return match ? Number(match[1]) : null;
}

function withDetails(response: SimulatedResponse, details: readonly Detail[]): SimulatedResponse {
  return { status: response.status, body: { ...(response.body as object), details } };
}

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
      'Access-Control-Expose-Headers': 'Idempotent-Replayed, Location',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}
