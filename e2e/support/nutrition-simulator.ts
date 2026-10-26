import { Page, Request, Route } from '@playwright/test';

import {
  CREATE_NUTRITION_PLAN_RESPONSES,
  FOOD_CATALOG_PATH,
  FOOD_CATALOG_RESPONSES,
  GET_NUTRITION_PLAN_RESPONSES,
  MY_NUTRITION_PLANS_PATH,
  MY_NUTRITION_PLANS_RESPONSES,
  NUTRITION_PLANS_PATH,
  SIMULATED_FOOD_CATALOG_ETAG,
} from '../../src/testing/bff-web/nutrition.fixtures';
import { SimulatedResponse } from '../../src/testing/bff-web/register-user.fixtures';

/**
 * Planes creados durante la prueba. Se comparte entre las páginas del profesional
 * y del deportista para que el plan asignado aparezca en «Mi alimentación», como
 * tras la proyección del backend.
 */
export interface NutritionPlansStore {
  readonly plans: Record<string, unknown>[];
}

export interface NutritionSimulation {
  readonly catalogRequests: Request[];
  readonly creates: Request[];
  readonly reads: Request[];
  readonly listRequests: Request[];
  /** Respuesta de la próxima solicitud de cada operación; luego vuelve al comportamiento normal. */
  nextCatalog: SimulatedResponse | null;
  nextCreate: SimulatedResponse | null;
  nextRead: SimulatedResponse | null;
  nextList: SimulatedResponse | null;
  /** Avisos de la respuesta de creación (CA6). */
  warnings: string[];
  /** Planes por página de `GET /v1/me/nutrition-plans`. */
  pageSize: number;
}

/**
 * Reemplaza las operaciones de HU014 del BFF con el simulador derivado del
 * contrato bff-web 0.18.0. Como el BFF real: sin `Authorization: Bearer` responde
 * `401 invalid_access_token`; el catálogo devuelve `ETag` y `304` con
 * `If-None-Match`; `POST /v1/nutrition-plans` exige `Idempotency-Key` y, si la
 * clave se repite, devuelve el mismo plan con `Idempotent-Replayed: true`; el plan
 * creado se puede consultar por su identificador y aparece en la lista del
 * deportista, más reciente primero, con un cursor opaco.
 */
export async function simulateNutrition(
  page: Page,
  store: NutritionPlansStore = { plans: [] },
): Promise<NutritionSimulation> {
  const simulation: NutritionSimulation = {
    catalogRequests: [],
    creates: [],
    reads: [],
    listRequests: [],
    nextCatalog: null,
    nextCreate: null,
    nextRead: null,
    nextList: null,
    warnings: [],
    pageSize: 20,
  };
  const plansByKey = new Map<string, Record<string, unknown>>();

  await page.route(`**${FOOD_CATALOG_PATH}`, async (route) => {
    if (route.request().method() !== 'GET') {
      return route.fallback();
    }
    simulation.catalogRequests.push(route.request());
    const rejected = (await unauthenticated(route)) ?? take(simulation, 'nextCatalog');
    if (rejected) {
      return fulfill(route, rejected);
    }
    const etag = { ETag: SIMULATED_FOOD_CATALOG_ETAG };
    if ((await route.request().headerValue('if-none-match')) === SIMULATED_FOOD_CATALOG_ETAG) {
      return fulfill(route, FOOD_CATALOG_RESPONSES.notModified, etag);
    }
    await fulfill(route, FOOD_CATALOG_RESPONSES.ok, etag);
  });

  await page.route(`**${NUTRITION_PLANS_PATH}`, async (route) => {
    if (route.request().method() !== 'POST') {
      return route.fallback();
    }
    simulation.creates.push(route.request());
    const rejected = (await unauthenticated(route)) ?? take(simulation, 'nextCreate');
    if (rejected) {
      return fulfill(route, rejected);
    }
    const key = (await route.request().headerValue('idempotency-key')) ?? '';
    const replayed = plansByKey.get(key);
    if (replayed) {
      return fulfill(route, { status: 201, body: replayed }, { 'Idempotent-Replayed': 'true' });
    }
    // El plan creado conserva lo que envió el cliente, con identificadores nuevos.
    const request = route.request().postDataJSON() as Record<string, unknown>;
    const { warnings, ...base } = CREATE_NUTRITION_PLAN_RESPONSES.created.body;
    void warnings;
    const plan = {
      ...base,
      plan_id: crypto.randomUUID(),
      title: request['title'],
      objectives: request['objectives'],
      start_date: request['start_date'],
      end_date: request['end_date'],
      meals: normalizeMeals(request['meals']),
      created_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    };
    plansByKey.set(key, { ...plan, warnings: simulation.warnings });
    store.plans.unshift(plan);
    await fulfill(route, { status: 201, body: { ...plan, warnings: simulation.warnings } });
  });

  await page.route(`**${NUTRITION_PLANS_PATH}/*`, async (route) => {
    if (route.request().method() !== 'GET') {
      return route.fallback();
    }
    simulation.reads.push(route.request());
    const planId = new URL(route.request().url()).pathname.split('/').pop();
    const plan = store.plans.find((item) => item['plan_id'] === planId);
    const response =
      (await unauthenticated(route)) ??
      take(simulation, 'nextRead') ??
      (plan ? { status: 200, body: plan } : GET_NUTRITION_PLAN_RESPONSES.nutritionPlanNotFound);
    await fulfill(route, response);
  });

  await page.route(`**${MY_NUTRITION_PLANS_PATH}*`, async (route) => {
    if (route.request().method() !== 'GET') {
      return route.fallback();
    }
    simulation.listRequests.push(route.request());
    const rejected = (await unauthenticated(route)) ?? take(simulation, 'nextList');
    if (rejected) {
      return fulfill(route, rejected);
    }
    // Cursor opaco con caracteres que una codificación laxa alteraría.
    const cursor = new URL(route.request().url()).searchParams.get('cursor');
    const match = /^p\+(\d+)\/=$/.exec(cursor ?? '');
    if (cursor !== null && match === null) {
      // Un cursor alterado en el camino se rechaza como lo haría el BFF.
      return fulfill(route, MY_NUTRITION_PLANS_RESPONSES.invalidCursor);
    }
    const offset = match === null ? 0 : Number(match[1]);
    const items = store.plans.slice(offset, offset + simulation.pageSize);
    const next = offset + simulation.pageSize;
    await fulfill(route, {
      status: 200,
      body: { items, next_cursor: next < store.plans.length ? `p+${next}/=` : null },
    });
  });

  return simulation;
}

/** El backend normaliza las cantidades a un decimal (`150` → `150.0`). */
function normalizeMeals(meals: unknown): unknown {
  return (meals as { meal_type: string; items: { quantity: string }[] }[]).map((meal) => ({
    ...meal,
    items: meal.items.map((item) => ({ ...item, quantity: Number(item.quantity).toFixed(1) })),
  }));
}

function take(
  simulation: NutritionSimulation,
  key: 'nextCatalog' | 'nextCreate' | 'nextRead' | 'nextList',
): SimulatedResponse | null {
  const response = simulation[key];
  simulation[key] = null;
  return response;
}

async function unauthenticated(route: Route): Promise<SimulatedResponse | null> {
  const authorization = (await route.request().headerValue('authorization')) ?? '';
  return /^Bearer \S+$/.test(authorization)
    ? null
    : CREATE_NUTRITION_PLAN_RESPONSES.invalidAccessToken;
}

/** CORS como el BFF: origen explícito y cabeceras de idempotencia y `ETag` expuestas. */
async function fulfill(
  route: Route,
  response: SimulatedResponse,
  headers: Record<string, string> = {},
): Promise<void> {
  const origin = (await route.request().headerValue('origin')) ?? '';
  await route.fulfill({
    status: response.status,
    ...(response.body === null ? { body: '' } : { json: response.body }),
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Expose-Headers': 'Location, Idempotent-Replayed, ETag, X-Correlation-ID',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}
