import { Page, Request, Route } from '@playwright/test';

import {
  HEALTH_REPORTS_RESPONSES,
  MY_HEALTH_REPORTS_PATH,
  healthReports,
} from '../../src/testing/bff-web/health-reports.fixtures';
import { SimulatedResponse } from '../../src/testing/bff-web/register-user.fixtures';

export interface HealthReportsSimulation {
  /** Solicitudes recibidas en ambas consultas de HU012. */
  readonly requests: Request[];
  /** Reportes del deportista, en el orden del contrato (`occurred_at` desc). */
  reports: ReturnType<typeof healthReports>;
  /** Deportistas que autorizaron al profesional; los demás reciben `403`. */
  authorizedAthletes: Set<string>;
  /** Respuesta de la próxima consulta; luego vuelve al comportamiento normal. */
  next: SimulatedResponse | null;
}

const ATHLETE_PATH = /^\/v1\/athletes\/([^/]+)\/health-reports$/;

/**
 * Reemplaza `GET /v1/me/health-reports` y `GET /v1/athletes/{id}/health-reports`
 * con el simulador del contrato bff-web 0.33.0. Como el BFF: sin `Bearer`
 * responde `401`; un deportista que no autorizó responde `403
 * athlete_authorization_required` sin revelar si existe (CA3); `to` anterior a
 * `from` o un cursor ilegible responden `422 validation_error` (CA6); filtra por
 * día UTC de `occurred_at` (inclusivo), `type` y `severity`, y pagina con `limit`
 * (20 por defecto) y un cursor opaco.
 */
export async function simulateHealthReports(
  page: Page,
  reports: ReturnType<typeof healthReports> = [],
): Promise<HealthReportsSimulation> {
  const simulation: HealthReportsSimulation = {
    requests: [],
    reports,
    authorizedAthletes: new Set(),
    next: null,
  };

  await page.route(
    (url) => url.pathname === MY_HEALTH_REPORTS_PATH || ATHLETE_PATH.test(url.pathname),
    async (route) => {
      if (route.request().method() !== 'GET') {
        return route.fallback();
      }
      simulation.requests.push(route.request());
      const authorization = (await route.request().headerValue('authorization')) ?? '';
      if (!/^Bearer \S+$/.test(authorization)) {
        return fulfill(route, HEALTH_REPORTS_RESPONSES.invalidAccessToken);
      }
      const next = simulation.next;
      simulation.next = null;
      if (next) {
        return fulfill(route, next);
      }
      const url = new URL(route.request().url());
      const athleteId = ATHLETE_PATH.exec(url.pathname)?.[1];
      if (athleteId !== undefined && !simulation.authorizedAthletes.has(athleteId)) {
        return fulfill(route, HEALTH_REPORTS_RESPONSES.athleteAuthorizationRequired);
      }
      const query = url.searchParams;
      const from = query.get('from');
      const to = query.get('to');
      const cursor = query.get('cursor');
      const offset = cursor === null ? 0 : decodeCursor(cursor);
      if ((from && to && to < from) || offset === null) {
        return fulfill(route, HEALTH_REPORTS_RESPONSES.validationError);
      }
      const day = (iso: string) => iso.slice(0, 10);
      const matches = simulation.reports.filter(
        (item) =>
          (!query.get('type') || item.type === query.get('type')) &&
          (!query.get('severity') || item.severity === query.get('severity')) &&
          (!from || day(item.occurred_at) >= from) &&
          (!to || day(item.occurred_at) <= to),
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

function decodeCursor(cursor: string): number | null {
  try {
    const [prefix, value] = atob(cursor).split(':');
    const offset = Number(value);
    return prefix === 'offset' && Number.isInteger(offset) && offset >= 0 ? offset : null;
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
