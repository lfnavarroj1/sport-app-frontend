import { Page, Request, Route } from '@playwright/test';

import {
  ACTOR_ITEMS,
  INTEGRATED_CALENDAR_PATH,
  INTEGRATED_CALENDAR_RESPONSES,
  integratedCalendar,
  sourcesOf,
} from '../../src/testing/bff-web/integrated-calendar.fixtures';
import { SimulatedResponse } from '../../src/testing/bff-web/register-user.fixtures';

export interface IntegratedCalendarSimulation {
  readonly requests: Request[];
  /** Respuesta de la próxima consulta; luego, el comportamiento normal. */
  next: SimulatedResponse | null;
}

const MAX_PERIOD_MS = 92 * 86_400_000;

function invalid(field: string, issue: string): SimulatedResponse {
  return {
    status: 422,
    body: {
      ...INTEGRATED_CALENDAR_RESPONSES.periodTooLong.body,
      details: [{ field: `query.${field}`, issue }],
    },
  };
}

/**
 * Reemplaza `GET /v1/me/integrated-calendar` con el simulador del contrato bff-web
 * 0.30.0 y ADR-039 para el actor `actorType`. Como el BFF: sin `Bearer` responde
 * `401`; valida el periodo (`required`, `invalid_datetime`, `ends_before_starts`,
 * `out_of_range` de más de 92 días) y devuelve las fuentes del actor con los
 * elementos que empiezan en `[from, to)` (las sesiones, por su fecha). La
 * composición la simula el BFF: la web nunca llama a los dominios.
 */
export async function simulateIntegratedCalendar(
  page: Page,
  actorType: string,
): Promise<IntegratedCalendarSimulation> {
  const simulation: IntegratedCalendarSimulation = { requests: [], next: null };

  await page.route(
    (url) => url.pathname === INTEGRATED_CALENDAR_PATH,
    async (route) => {
      simulation.requests.push(route.request());
      const authorization = (await route.request().headerValue('authorization')) ?? '';
      if (!/^Bearer \S+$/.test(authorization)) {
        return fulfill(route, INTEGRATED_CALENDAR_RESPONSES.invalidAccessToken);
      }
      const forced = simulation.next;
      simulation.next = null;
      if (forced) {
        return fulfill(route, forced);
      }
      const params = new URL(route.request().url()).searchParams;
      const fromParam = params.get('from');
      const toParam = params.get('to');
      if ((fromParam === null) !== (toParam === null)) {
        return fulfill(route, invalid(fromParam === null ? 'from' : 'to', 'required'));
      }
      const from = Date.parse(fromParam ?? '');
      const to = Date.parse(toParam ?? '');
      if (Number.isNaN(from) || Number.isNaN(to)) {
        return fulfill(route, invalid('from', 'invalid_datetime'));
      }
      if (to <= from) {
        return fulfill(route, invalid('to', 'ends_before_starts'));
      }
      if (to - from > MAX_PERIOD_MS) {
        return fulfill(route, invalid('to', 'out_of_range'));
      }
      const items = (ACTOR_ITEMS[actorType] ?? []).filter((item) => {
        const start = item.starts_at === null ? Date.parse(`${item.occurs_on}T12:00:00Z`) : Date.parse(item.starts_at);
        return start >= from && start < to;
      });
      await fulfill(route, {
        status: 200,
        body: integratedCalendar(items, sourcesOf(actorType), {
          from: new Date(from).toISOString().replace('.000Z', 'Z'),
          to: new Date(to).toISOString().replace('.000Z', 'Z'),
        }),
      });
    },
  );

  return simulation;
}

/** CORS como el BFF: origen explícito y credenciales. */
async function fulfill(route: Route, response: SimulatedResponse): Promise<void> {
  const origin = (await route.request().headerValue('origin')) ?? '';
  await route.fulfill({
    status: response.status,
    ...(response.body === null ? { body: '' } : { json: response.body }),
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Expose-Headers': 'X-Correlation-ID',
      'Cache-Control': 'no-store',
    },
  });
}
