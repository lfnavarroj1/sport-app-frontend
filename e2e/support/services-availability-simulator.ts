import { Page, Request, Route } from '@playwright/test';

import { SimulatedResponse } from '../../src/testing/bff-web/register-user.fixtures';
import {
  SERVICES_AVAILABILITY_PATH,
  SERVICES_AVAILABILITY_RESPONSES,
  catalogService,
} from '../../src/testing/bff-web/services-availability.fixtures';

type CatalogService = ReturnType<typeof catalogService>;

/** Categoría que solo ve el deportista con la capacidad `PREMIUM` (ADR-038). */
const RESTRICTED_CATEGORY = 'SPORTS_MEDICINE';
const MAX_PERIOD_MS = 31 * 86_400_000;
const OFFSET_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

export interface ServicesAvailabilitySimulation {
  /** Solicitudes recibidas en `GET /v1/services/availability`. */
  readonly requests: Request[];
  /**
   * Servicios publicados del catálogo completo, incluidos los de medicina
   * deportiva y los que no tienen espacios en el periodo (`available: false`).
   */
  services: CatalogService[];
  /** El deportista de la sesión tiene la capacidad `services.sports_medicine.access`. */
  premium: boolean;
  /** Respuestas de las próximas consultas, en orden; luego, el comportamiento normal. */
  readonly next: SimulatedResponse[];
}

/**
 * Reemplaza `GET /v1/services/availability` con el simulador del contrato bff-web
 * 0.12.0 y ADR-038. Como el BFF: sin `Bearer` responde `401`; sin `from`/`to`
 * con desfase o con un periodo vacío o mayor de 31 días responde `422`; filtra
 * `category` y `modality` repetibles; `availability=available` (por defecto)
 * excluye los servicios sin espacios y `all` los incluye; sin `premium` omite
 * medicina deportiva y la declara en `restricted_categories` (siempre `200`,
 * también si se pidió esa categoría); ordena por (`name`, `service_id`) y pagina
 * con `limit` (20 por defecto) y un cursor opaco. Los intervalos de cada
 * servicio se devuelven tal como están en `services` (no se recortan al periodo).
 */
export async function simulateServicesAvailability(
  page: Page,
  services: CatalogService[] = [],
  premium = false,
): Promise<ServicesAvailabilitySimulation> {
  const simulation: ServicesAvailabilitySimulation = { requests: [], services, premium, next: [] };

  const handler = async (route: Route) => {
    if (route.request().method() !== 'GET') {
      return route.fallback();
    }
    simulation.requests.push(route.request());
    const authorization = (await route.request().headerValue('authorization')) ?? '';
    if (!/^Bearer \S+$/.test(authorization)) {
      return fulfill(route, SERVICES_AVAILABILITY_RESPONSES.invalidAccessToken);
    }
    const queued = simulation.next.shift();
    if (queued) {
      return fulfill(route, queued);
    }
    const query = new URL(route.request().url()).searchParams;
    if (!validPeriod(query.get('from'), query.get('to'))) {
      return fulfill(route, SERVICES_AVAILABILITY_RESPONSES.validationError);
    }
    const categories = query.getAll('category');
    const modalities = query.getAll('modality');
    const includeUnavailable = query.get('availability') === 'all';
    const matches = simulation.services
      .filter(
        (item) =>
          (simulation.premium || item.category !== RESTRICTED_CATEGORY) &&
          (categories.length === 0 || categories.includes(item.category)) &&
          (modalities.length === 0 || modalities.includes(item.modality)) &&
          (includeUnavailable || item.available),
      )
      .sort((a, b) => a.name.localeCompare(b.name) || a.service_id.localeCompare(b.service_id));
    const limit = Number(query.get('limit') ?? 20);
    const offset = query.get('cursor') ? Number(atob(query.get('cursor')!).split(':')[1]) : 0;
    const items = matches.slice(offset, offset + limit);
    const more = offset + limit < matches.length;
    await fulfill(route, {
      status: 200,
      body: {
        items,
        next_cursor: more ? btoa(`offset:${offset + limit}`) : null,
        restricted_categories: simulation.premium ? [] : [RESTRICTED_CATEGORY],
      },
    });
  };

  await page.route((url) => url.pathname === SERVICES_AVAILABILITY_PATH, handler);
  return simulation;
}

/** `from` y `to` obligatorios, con desfase, y `0 < to − from ≤ 31 días`. */
function validPeriod(from: string | null, to: string | null): boolean {
  if (!from || !to || !OFFSET_INSTANT.test(from) || !OFFSET_INSTANT.test(to)) {
    return false;
  }
  const span = Date.parse(to) - Date.parse(from);
  return span > 0 && span <= MAX_PERIOD_MS;
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
