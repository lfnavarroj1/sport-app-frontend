import { Page, Request, Route } from '@playwright/test';

import {
  MY_SERVICE_RESPONSES,
  MY_SERVICES_PATH,
  MY_SERVICES_RESPONSES,
  PUBLISH_SERVICE_RESPONSES,
  ownService,
} from '../../src/testing/bff-web/publish-service.fixtures';
import { SimulatedResponse } from '../../src/testing/bff-web/register-user.fixtures';

type OwnServiceDto = ReturnType<typeof ownService>;

export interface PublishServicesSimulation {
  /** Servicios propios del profesional, en el orden del backend. */
  services: OwnServiceDto[];
  readonly listRequests: Request[];
  readonly detailRequests: Request[];
  readonly publishRequests: Request[];
  /** Respuestas de las próximas publicaciones, en orden; luego, el comportamiento normal. */
  readonly nextPublish: SimulatedResponse[];
  /**
   * La próxima publicación se procesa (cambia el estado y guarda la clave), pero
   * su respuesta se pierde en la red. Tiene prioridad sobre `nextPublish`.
   */
  loseNextResponse: boolean;
}

const DETAIL_PATH = /^\/v1\/me\/services\/([^/]+)$/;
const PUBLISH_PATH = /^\/v1\/services\/([^/]+)\/publish$/;

/**
 * Reemplaza `GET /v1/me/services`, `GET /v1/me/services/{service_id}` y
 * `POST /v1/services/{service_id}/publish` con el simulador del contrato bff-web
 * 0.16.0 y ADR-027. Como el BFF: sin `Bearer` responde `401`; la lista filtra por
 * estado y pagina con un cursor opaco; un servicio desconocido responde `404`.
 * Publicar un borrador con algún horario futuro lo pasa a `PUBLISHED` con
 * versión + 1; sin horarios futuros responde `422` `availability` `required`; ya
 * publicado responde `200` con su estado. La misma clave con el mismo servicio
 * repite la respuesta con `Idempotent-Replayed: true`, y con otro responde `409`.
 * Sin proyección: la lista refleja el cambio en la consulta siguiente.
 */
export async function simulatePublishServices(
  page: Page,
  services: OwnServiceDto[] = [],
): Promise<PublishServicesSimulation> {
  const simulation: PublishServicesSimulation = {
    services,
    listRequests: [],
    detailRequests: [],
    publishRequests: [],
    nextPublish: [],
    loseNextResponse: false,
  };
  const byKey = new Map<string, { serviceId: string; body: unknown }>();

  const authorized = async (route: Route) =>
    /^Bearer \S+$/.test((await route.request().headerValue('authorization')) ?? '');

  await page.route(
    (url) => url.pathname === MY_SERVICES_PATH,
    async (route) => {
      if (route.request().method() !== 'GET') {
        return route.fallback();
      }
      simulation.listRequests.push(route.request());
      if (!(await authorized(route))) {
        return fulfill(route, MY_SERVICES_RESPONSES.invalidAccessToken);
      }
      const query = new URL(route.request().url()).searchParams;
      const matches = simulation.services.filter(
        (service) => !query.get('status') || service.status === query.get('status'),
      );
      const limit = Number(query.get('limit') ?? 20);
      const offset = query.get('cursor') ? Number(atob(query.get('cursor')!).split(':')[1]) : 0;
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

  await page.route(
    (url) => DETAIL_PATH.test(url.pathname),
    async (route) => {
      if (route.request().method() !== 'GET') {
        return route.fallback();
      }
      simulation.detailRequests.push(route.request());
      if (!(await authorized(route))) {
        return fulfill(route, MY_SERVICE_RESPONSES.invalidAccessToken);
      }
      const id = DETAIL_PATH.exec(new URL(route.request().url()).pathname)![1];
      const service = simulation.services.find((item) => item.service_id === id);
      await fulfill(
        route,
        service ? { status: 200, body: service } : MY_SERVICE_RESPONSES.serviceNotFound,
      );
    },
  );

  await page.route(
    (url) => PUBLISH_PATH.test(url.pathname),
    async (route) => {
      if (route.request().method() !== 'POST') {
        return route.fallback();
      }
      simulation.publishRequests.push(route.request());
      if (!(await authorized(route))) {
        return fulfill(route, PUBLISH_SERVICE_RESPONSES.invalidAccessToken);
      }
      const lose = simulation.loseNextResponse;
      simulation.loseNextResponse = false;
      const queued = lose ? undefined : simulation.nextPublish.shift();
      if (queued) {
        return fulfill(route, queued);
      }
      const id = PUBLISH_PATH.exec(new URL(route.request().url()).pathname)![1];
      const key = (await route.request().headerValue('idempotency-key')) ?? '';
      const previous = byKey.get(key);
      if (previous) {
        return previous.serviceId === id
          ? fulfill(route, { status: 200, body: previous.body }, { 'Idempotent-Replayed': 'true' })
          : fulfill(route, PUBLISH_SERVICE_RESPONSES.idempotencyKeyReused);
      }
      const index = simulation.services.findIndex((item) => item.service_id === id);
      if (index < 0) {
        return fulfill(route, PUBLISH_SERVICE_RESPONSES.serviceNotFound);
      }
      const service = simulation.services[index];
      const upcoming = service.availability.some(
        (interval) => new Date(interval.starts_at).getTime() > Date.now(),
      );
      if (service.status === 'DRAFT' && !upcoming) {
        return fulfill(route, PUBLISH_SERVICE_RESPONSES.availabilityRequired);
      }
      const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
      const updated: OwnServiceDto =
        service.status === 'PUBLISHED'
          ? service
          : {
              ...service,
              status: 'PUBLISHED',
              version: service.version + 1,
              updated_at: now,
              published_at: now,
            };
      simulation.services[index] = updated;
      const body = {
        service_id: updated.service_id,
        provider_id: updated.provider_id,
        status: 'PUBLISHED',
        version: updated.version,
        published_at: updated.published_at,
        updated_at: updated.updated_at,
      };
      byKey.set(key, { serviceId: id, body });
      if (lose) {
        return route.abort('connectionfailed');
      }
      await fulfill(route, { status: 200, body });
    },
  );

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
      'Access-Control-Expose-Headers': 'Idempotent-Replayed, X-Correlation-ID',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}
