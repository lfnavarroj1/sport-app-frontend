import { Page, Request, Route } from '@playwright/test';

import {
  MY_ROUTINES_PATH,
  MY_ROUTINES_RESPONSES,
  PUBLISH_ROUTINE_RESPONSES,
  RETIRE_ROUTINE_RESPONSES,
  ROUTINES_PATH,
  SIMULATED_ROUTINES_PROFESSIONAL_ID,
  professionalRoutine,
} from '../../src/testing/bff-web/nutrition-routines.fixtures';
import { SIMULATED_FOOD_CATALOG } from '../../src/testing/bff-web/nutrition.fixtures';
import { SimulatedResponse } from '../../src/testing/bff-web/register-user.fixtures';

type RoutineDto = ReturnType<typeof professionalRoutine>;
interface Detail {
  readonly field: string;
  readonly issue: string;
}

export interface NutritionRoutinesSimulation {
  /** Rutinas del profesional, de la más reciente a la más antigua (orden del contrato). */
  routines: RoutineDto[];
  readonly listRequests: Request[];
  readonly publishRequests: Request[];
  readonly retireRequests: Request[];
  /** Respuestas de las próximas consultas de la lista, en orden; luego, lo normal. */
  readonly nextList: SimulatedResponse[];
  /** Respuestas de las próximas publicaciones, en orden; luego, lo normal. */
  readonly nextPublish: SimulatedResponse[];
  /**
   * Publicaciones que el BFF confirma pero cuya respuesta se pierde (`503`): la
   * rutina queda creada y la misma clave repite el `201` con
   * `Idempotent-Replayed: true`. Se aplican después de `nextPublish`.
   */
  lostResponses: number;
}

const RETIRE_PATH = /^\/v1\/nutrition-routine-templates\/([^/]+)\/retire$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_LIMIT = 20;
/** Catálogo de alergias de HU009, en su orden (esquema `Allergy`). */
const ALLERGY_ORDER = [
  'PEANUTS',
  'TREE_NUTS',
  'MILK',
  'EGGS',
  'WHEAT',
  'SOY',
  'FISH',
  'SHELLFISH',
  'SESAME',
];
const FOODS = new Map<string, { allergens: readonly string[]; incompatible: readonly string[] }>(
  SIMULATED_FOOD_CATALOG.items.map((item) => [
    item.food_code,
    { allergens: item.allergens, incompatible: item.incompatible_with },
  ]),
);

/**
 * Reemplaza `POST /v1/nutrition-routine-templates`,
 * `POST /v1/nutrition-routine-templates/{template_id}/retire` y
 * `GET /v1/me/nutrition-routine-templates` con el simulador del contrato bff-web
 * 0.34.0 y ADR-041. Como el BFF: sin `Bearer` responde `401`; publicar exige
 * `Idempotency-Key` UUID y la misma clave con el mismo cuerpo repite la respuesta
 * con `Idempotent-Replayed: true` (con otro cuerpo, `409 idempotency_key_reused`);
 * las reglas del servicio responden `422` con `body.<campo>` y el alimento como
 * `daily_meals.I.items.J.food_code` (título 3–120 y descripción 1–2000
 * recortados, días 1–90, porciones 1–10, alimento fuera del catálogo simulado de
 * HU014 `unknown_value` o incompatible con el patrón `conflicts_with_restriction`);
 * la rutina nace `PUBLISHED` en versión 1 con el profesional del token y con los
 * alérgenos declarados más los de cada alimento, en el orden de HU009. Retirar
 * exige la versión vigente (`409 version_conflict` con la vigente), una rutina
 * ajena responde `404 template_not_found` y una ya retirada se devuelve tal cual.
 * La lista pagina de 20 en 20.
 */
export async function simulateNutritionRoutines(
  page: Page,
  routines: RoutineDto[] = [],
): Promise<NutritionRoutinesSimulation> {
  const simulation: NutritionRoutinesSimulation = {
    routines,
    listRequests: [],
    publishRequests: [],
    retireRequests: [],
    nextList: [],
    nextPublish: [],
    lostResponses: 0,
  };
  const replays = new Map<string, { body: string; response: SimulatedResponse }>();
  let clock = Date.parse('2026-10-26T16:00:00Z');
  const now = () => new Date((clock += 60_000)).toISOString().replace('.000Z', 'Z');

  const authorized = async (route: Route) =>
    /^Bearer \S+$/.test((await route.request().headerValue('authorization')) ?? '');

  await page.route(
    (url) => url.pathname === MY_ROUTINES_PATH,
    async (route) => {
      if (route.request().method() !== 'GET') {
        return route.fallback();
      }
      simulation.listRequests.push(route.request());
      if (!(await authorized(route))) {
        return fulfill(route, MY_ROUTINES_RESPONSES.invalidAccessToken);
      }
      const queued = simulation.nextList.shift();
      if (queued) {
        return fulfill(route, queued);
      }
      const url = new URL(route.request().url());
      const limit = Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT);
      const cursor = url.searchParams.get('cursor');
      const start = cursor === null ? 0 : position(cursor);
      if (start === null) {
        return fulfill(route, MY_ROUTINES_RESPONSES.invalidCursor);
      }
      const end = start + limit;
      await fulfill(route, {
        status: 200,
        body: {
          items: simulation.routines.slice(start, end),
          next_cursor: end < simulation.routines.length ? `rutinas-desde-${end}` : null,
        },
      });
    },
  );

  await page.route(
    (url) => url.pathname === ROUTINES_PATH,
    async (route) => {
      if (route.request().method() !== 'POST') {
        return route.fallback();
      }
      simulation.publishRequests.push(route.request());
      if (!(await authorized(route))) {
        return fulfill(route, PUBLISH_ROUTINE_RESPONSES.invalidAccessToken);
      }
      const queued = simulation.nextPublish.shift();
      if (queued) {
        return fulfill(route, queued);
      }
      const key = (await route.request().headerValue('idempotency-key')) ?? '';
      if (!UUID.test(key)) {
        return fulfill(
          route,
          withDetails(PUBLISH_ROUTINE_RESPONSES.validationError, [
            { field: 'Idempotency-Key', issue: 'required' },
          ]),
        );
      }
      const body = route.request().postData() ?? '';
      const previous = replays.get(key);
      if (previous) {
        return previous.body === body
          ? fulfill(route, previous.response, { 'Idempotent-Replayed': 'true' })
          : fulfill(route, PUBLISH_ROUTINE_RESPONSES.idempotencyKeyReused);
      }
      const request = JSON.parse(body) as Record<string, unknown>;
      const violations = rejected(request);
      if (violations.length > 0) {
        return fulfill(route, withDetails(PUBLISH_ROUTINE_RESPONSES.validationError, violations));
      }
      const instant = now();
      // Los datos de la rutina son los de la solicitud (el `RoutineResponse` del contrato).
      const created = {
        ...professionalRoutine(0),
        ...request,
        contains_allergens: confirmedAllergens(request),
        template_id: crypto.randomUUID(),
        professional_id: SIMULATED_ROUTINES_PROFESSIONAL_ID,
        status: 'PUBLISHED',
        version: 1,
        created_at: instant,
        updated_at: instant,
        published_at: instant,
        retired_at: null,
      } as RoutineDto;
      simulation.routines = [created, ...simulation.routines];
      const response = { status: 201, body: created };
      replays.set(key, { body, response });
      if (simulation.lostResponses > 0) {
        // Confirmada en el backend, pero la respuesta no llega al navegador.
        simulation.lostResponses--;
        return fulfill(route, PUBLISH_ROUTINE_RESPONSES.upstreamUnavailable);
      }
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
        return fulfill(route, RETIRE_ROUTINE_RESPONSES.invalidAccessToken);
      }
      const id = decodeURIComponent(RETIRE_PATH.exec(new URL(route.request().url()).pathname)![1]);
      const current = simulation.routines.find((item) => item.template_id === id);
      if (!current) {
        return fulfill(route, RETIRE_ROUTINE_RESPONSES.templateNotFound);
      }
      if (current.status === 'RETIRED') {
        return fulfill(route, { status: 200, body: current });
      }
      const expected = (route.request().postDataJSON() as { expected_version?: number })
        .expected_version;
      if (expected !== current.version) {
        return fulfill(
          route,
          withDetails(RETIRE_ROUTINE_RESPONSES.versionConflict, [
            { field: 'expected_version', issue: String(current.version) },
          ]),
        );
      }
      const instant = now();
      const retired: RoutineDto = {
        ...current,
        status: 'RETIRED',
        version: current.version + 1,
        updated_at: instant,
        retired_at: instant,
      };
      simulation.routines = simulation.routines.map((item) =>
        item.template_id === id ? retired : item,
      );
      await fulfill(route, { status: 200, body: retired });
    },
  );

  return simulation;
}

interface MealRequest {
  readonly items?: readonly { food_code?: string; portions?: unknown }[];
}

/** Reglas que el simulador reproduce (contrato 0.34.0 y ADR-041), con el prefijo `body.`. */
function rejected(request: Record<string, unknown>): Detail[] {
  const details: Detail[] = [];
  const title = String(request['title'] ?? '').trim();
  if (title.length < 3 || title.length > 120) {
    details.push({ field: 'body.title', issue: 'invalid_length' });
  }
  const description = String(request['description'] ?? '').trim();
  if (description.length < 1 || description.length > 2000) {
    details.push({ field: 'body.description', issue: 'invalid_length' });
  }
  if (!inRange(request['duration_days'], 1, 90)) {
    details.push({ field: 'body.duration_days', issue: 'out_of_range' });
  }
  const pattern = String(request['dietary_pattern'] ?? '');
  const meals = (request['daily_meals'] as MealRequest[] | undefined) ?? [];
  meals.forEach((meal, m) => {
    (meal.items ?? []).forEach((item, i) => {
      const prefix = `body.daily_meals.${m}.items.${i}`;
      if (!inRange(item.portions, 1, 10)) {
        details.push({ field: `${prefix}.portions`, issue: 'out_of_range' });
      }
      const food = FOODS.get(String(item.food_code ?? ''));
      if (!food) {
        details.push({ field: `${prefix}.food_code`, issue: 'unknown_value' });
      } else if (food.incompatible.includes(pattern)) {
        details.push({ field: `${prefix}.food_code`, issue: 'conflicts_with_restriction' });
      }
    });
  });
  return details;
}

/** Los declarados más los de cada alimento del catálogo, sin repetir y en el orden de HU009. */
function confirmedAllergens(request: Record<string, unknown>): string[] {
  const all = new Set((request['contains_allergens'] as string[] | undefined) ?? []);
  for (const meal of (request['daily_meals'] as MealRequest[] | undefined) ?? []) {
    for (const item of meal.items ?? []) {
      for (const allergen of FOODS.get(String(item.food_code ?? ''))?.allergens ?? []) {
        all.add(allergen);
      }
    }
  }
  return ALLERGY_ORDER.filter((allergen) => all.has(allergen));
}

function inRange(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function position(cursor: string): number | null {
  const match = /^rutinas-desde-(\d+)$/.exec(cursor);
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
