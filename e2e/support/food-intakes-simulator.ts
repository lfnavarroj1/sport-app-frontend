import { Page, Request, Route } from '@playwright/test';

import {
  FOOD_INTAKES_RESPONSES,
  MY_FOOD_INTAKES_PATH,
  foodIntakes,
} from '../../src/testing/bff-web/food-intakes.fixtures';
import { SimulatedResponse } from '../../src/testing/bff-web/register-user.fixtures';

export interface FoodIntakesSimulation {
  /** Solicitudes recibidas en ambas consultas de HU013. */
  readonly requests: Request[];
  /** Consumos del deportista, en el orden del contrato (`consumed_at` desc). */
  intakes: ReturnType<typeof foodIntakes>;
  /** Deportistas que autorizaron al profesional; los demás reciben `403`. */
  authorizedAthletes: Set<string>;
  /** Respuesta de la próxima consulta; luego vuelve al comportamiento normal. */
  next: SimulatedResponse | null;
}

const ATHLETE_PATH = /^\/v1\/athletes\/([^/]+)\/food-intakes$/;

/**
 * Reemplaza `GET /v1/me/food-intakes` y `GET /v1/athletes/{id}/food-intakes` con
 * el simulador del contrato bff-web 0.32.0. Como el BFF: sin `Bearer` responde
 * `401`; un deportista que no autorizó responde `403 athlete_authorization_required`
 * (CA3); `to` anterior a `from` o un cursor ilegible responden `422` con el motivo
 * del contrato (CA2); filtra por día UTC de `consumed_at` (inclusivo) y por
 * `meal_type`, y pagina con `limit` (20 por defecto) y un cursor opaco (CA4).
 */
export async function simulateFoodIntakes(
  page: Page,
  intakes: ReturnType<typeof foodIntakes> = [],
): Promise<FoodIntakesSimulation> {
  const simulation: FoodIntakesSimulation = {
    requests: [],
    intakes,
    authorizedAthletes: new Set(),
    next: null,
  };

  await page.route(
    (url) => url.pathname === MY_FOOD_INTAKES_PATH || ATHLETE_PATH.test(url.pathname),
    async (route) => {
      if (route.request().method() !== 'GET') {
        return route.fallback();
      }
      simulation.requests.push(route.request());
      const authorization = (await route.request().headerValue('authorization')) ?? '';
      if (!/^Bearer \S+$/.test(authorization)) {
        return fulfill(route, FOOD_INTAKES_RESPONSES.invalidAccessToken);
      }
      const next = simulation.next;
      simulation.next = null;
      if (next) {
        return fulfill(route, next);
      }
      const url = new URL(route.request().url());
      const athleteId = ATHLETE_PATH.exec(url.pathname)?.[1];
      if (athleteId !== undefined && !simulation.authorizedAthletes.has(athleteId)) {
        return fulfill(route, FOOD_INTAKES_RESPONSES.athleteAuthorizationRequired);
      }
      const query = url.searchParams;
      const from = query.get('from');
      const to = query.get('to');
      if (from && to && to < from) {
        return fulfill(route, FOOD_INTAKES_RESPONSES.toBeforeFrom);
      }
      const offset = readCursor(query.get('cursor'));
      if (offset === null) {
        return fulfill(route, FOOD_INTAKES_RESPONSES.invalidCursor);
      }
      const day = (iso: string) => iso.slice(0, 10);
      const matches = simulation.intakes.filter(
        (item) =>
          (!query.get('meal_type') || item.meal_type === query.get('meal_type')) &&
          (!from || day(item.consumed_at) >= from) &&
          (!to || day(item.consumed_at) <= to),
      );
      const limit = Number(query.get('limit') ?? 20);
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
  return simulation;
}

/** Posición del cursor opaco; `0` sin cursor y `null` si no se puede leer. */
function readCursor(cursor: string | null): number | null {
  if (!cursor) {
    return 0;
  }
  try {
    const match = /^offset:(\d+)$/.exec(atob(cursor));
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
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
