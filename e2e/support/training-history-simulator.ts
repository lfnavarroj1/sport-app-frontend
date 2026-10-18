import { Page, Request, Route } from '@playwright/test';

import { SimulatedResponse } from '../../src/testing/bff-web/register-user.fixtures';
import {
  TRAINING_ATHLETES_PATH,
  TRAINING_ATHLETES_RESPONSES,
  TRAINING_HISTORY_RESPONSES,
  historyItems,
  trainingAthletes,
} from '../../src/testing/bff-web/training-history.fixtures';

export interface TrainingHistorySimulation {
  /** Solicitudes recibidas en ambas consultas de HU011. */
  readonly requests: Request[];
  /** Sesiones terminadas del deportista, en el orden del contrato (`ended_at` desc). */
  sessions: ReturnType<typeof historyItems>;
  /** Respuesta de la próxima consulta; luego vuelve al comportamiento normal. */
  next: SimulatedResponse | null;
  /** Solicitudes recibidas en `GET /v1/me/training-athletes` (CA5). */
  readonly athleteRequests: Request[];
  /** Deportistas con autorización vigente, en el orden del contrato. */
  athletes: ReturnType<typeof trainingAthletes>;
  /** Respuesta de la próxima consulta de deportistas; luego vuelve a la normal. */
  nextAthletes: SimulatedResponse | null;
}

/**
 * Reemplaza `GET /v1/training-history`, `GET /v1/athletes/{id}/training-history` y
 * `GET /v1/me/training-athletes` con el simulador del contrato bff-web 0.15.0. Como
 * el BFF: sin `Bearer` responde `401`; filtra por deporte y por fecha de fin
 * inclusiva (día UTC); pagina con `limit` (20 por defecto) y un cursor opaco;
 * `filters.sports` lista los deportes del historial completo.
 */
export async function simulateTrainingHistory(
  page: Page,
  sessions: ReturnType<typeof historyItems> = [],
): Promise<TrainingHistorySimulation> {
  const simulation: TrainingHistorySimulation = {
    requests: [],
    sessions,
    next: null,
    athleteRequests: [],
    athletes: [],
    nextAthletes: null,
  };

  const handler = async (route: Route) => {
    if (route.request().method() !== 'GET') {
      return route.fallback();
    }
    simulation.requests.push(route.request());
    const authorization = (await route.request().headerValue('authorization')) ?? '';
    if (!/^Bearer \S+$/.test(authorization)) {
      return fulfill(route, TRAINING_HISTORY_RESPONSES.invalidAccessToken);
    }
    const next = simulation.next;
    simulation.next = null;
    if (next) {
      return fulfill(route, next);
    }
    const query = new URL(route.request().url()).searchParams;
    const day = (iso: string) => iso.slice(0, 10);
    const matches = simulation.sessions.filter(
      (item) =>
        (!query.get('sport') || item.sport === query.get('sport')) &&
        (!query.get('from') || day(item.ended_at) >= query.get('from')!) &&
        (!query.get('to') || day(item.ended_at) <= query.get('to')!),
    );
    const limit = Number(query.get('limit') ?? 20);
    const offset = query.get('cursor') ? Number(atob(query.get('cursor')!).split(':')[1]) : 0;
    const items = matches.slice(offset, offset + limit);
    const more = offset + limit < matches.length;
    await fulfill(route, {
      status: 200,
      body: {
        items,
        next_cursor: more ? btoa(`offset:${offset + limit}`) : null,
        filters: { sports: [...new Set(simulation.sessions.map((item) => item.sport))] },
      },
    });
  };

  // CA5: deportistas que autorizaron al profesional, con paginación por cursor.
  const athletesHandler = async (route: Route) => {
    if (route.request().method() !== 'GET') {
      return route.fallback();
    }
    simulation.athleteRequests.push(route.request());
    const authorization = (await route.request().headerValue('authorization')) ?? '';
    if (!/^Bearer \S+$/.test(authorization)) {
      return fulfill(route, TRAINING_ATHLETES_RESPONSES.invalidAccessToken);
    }
    const next = simulation.nextAthletes;
    simulation.nextAthletes = null;
    if (next) {
      return fulfill(route, next);
    }
    const query = new URL(route.request().url()).searchParams;
    const limit = Number(query.get('limit') ?? 20);
    const offset = query.get('cursor') ? Number(atob(query.get('cursor')!).split(':')[1]) : 0;
    const more = offset + limit < simulation.athletes.length;
    await fulfill(route, {
      status: 200,
      body: {
        items: simulation.athletes.slice(offset, offset + limit),
        next_cursor: more ? btoa(`offset:${offset + limit}`) : null,
      },
    });
  };
  await page.route((url) => url.pathname === TRAINING_ATHLETES_PATH, athletesHandler);

  await page.route(
    (url) =>
      url.pathname === '/v1/training-history' ||
      /^\/v1\/athletes\/[^/]+\/training-history$/.test(url.pathname),
    handler,
  );
  return simulation;
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
