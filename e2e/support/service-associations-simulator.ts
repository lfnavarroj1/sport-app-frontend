import { Page, Request, Route } from '@playwright/test';

import { SimulatedResponse } from '../../src/testing/bff-web/register-user.fixtures';
import {
  ASSOCIATE_SERVICE_RESPONSES,
  DISSOCIATE_SERVICE_RESPONSES,
  SERVICE_ASSOCIATIONS_PATH,
  SERVICE_ASSOCIATIONS_RESPONSES,
  serviceAssociation,
} from '../../src/testing/bff-web/service-associations.fixtures';
import { catalogService } from '../../src/testing/bff-web/services-availability.fixtures';

type CatalogService = ReturnType<typeof catalogService>;
type Association = ReturnType<typeof serviceAssociation>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STATUSES = ['ACTIVE', 'INACTIVE', 'ALL'];

export interface ServiceAssociationsSimulation {
  /** Solicitudes recibidas en `/v1/me/service-associations` y `/{association_id}`. */
  readonly requests: Request[];
  /** Servicios publicados que existen para el BFF (solo los médicos se pueden asociar). */
  services: CatalogService[];
  /** Asociaciones del deportista, de la más reciente a la más antigua. */
  associations: Association[];
  /** El deportista tiene `services.sports_medicine.access`. */
  premium: boolean;
  /** Respuestas de las próximas solicitudes, en orden; luego, el comportamiento normal. */
  readonly next: SimulatedResponse[];
}

/**
 * Reemplaza las tres operaciones de HU017 con el simulador del contrato bff-web
 * 0.25.0 y ADR-038. Como el BFF: sin `Bearer` responde `401`; sin la capacidad,
 * `403 capability_required`. `POST` exige `Idempotency-Key` UUID y `{service_id}`
 * (`422`), responde `404 service_not_found` si el servicio no existe o no es de
 * medicina deportiva, `409 association_exists` con la activa en `details` y repite
 * la respuesta original con `Idempotent-Replayed: true` si se reutiliza la clave
 * con el mismo servicio. `DELETE` deja la asociación `INACTIVE` con `ended_at` y
 * responde `204` también si ya lo estaba; `404 association_not_found` si no existe.
 * `GET` filtra por `status` (`ACTIVE` por defecto) y pagina con `limit` y un
 * cursor opaco.
 */
export async function simulateServiceAssociations(
  page: Page,
  services: CatalogService[] = [],
  premium = true,
): Promise<ServiceAssociationsSimulation> {
  const simulation: ServiceAssociationsSimulation = {
    requests: [],
    services,
    associations: [],
    premium,
    next: [],
  };
  const keys = new Map<string, { serviceId: string; association: Association }>();
  let created = 0;

  const handler = async (route: Route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      return route.fallback();
    }
    simulation.requests.push(request);
    const authorization = (await request.headerValue('authorization')) ?? '';
    if (!/^Bearer \S+$/.test(authorization)) {
      return fulfill(route, SERVICE_ASSOCIATIONS_RESPONSES.invalidAccessToken);
    }
    const queued = simulation.next.shift();
    if (queued) {
      return fulfill(route, queued);
    }
    if (!simulation.premium) {
      return fulfill(route, SERVICE_ASSOCIATIONS_RESPONSES.capabilityRequired);
    }
    const url = new URL(request.url());
    const associationId = url.pathname.slice(SERVICE_ASSOCIATIONS_PATH.length + 1);

    if (request.method() === 'DELETE') {
      const association = simulation.associations.find(
        (item) => item.association_id === associationId,
      );
      if (!association) {
        return fulfill(route, DISSOCIATE_SERVICE_RESPONSES.associationNotFound);
      }
      if (association.status === 'ACTIVE') {
        association.status = 'INACTIVE';
        association.ended_at = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
        association.version += 1;
      }
      return fulfill(route, { status: 204, body: null });
    }

    if (request.method() === 'POST') {
      const key = (await request.headerValue('idempotency-key')) ?? '';
      const body = request.postDataJSON() as { service_id?: unknown } | null;
      const serviceId = typeof body?.service_id === 'string' ? body.service_id : '';
      if (!UUID.test(key) || !UUID.test(serviceId) || Object.keys(body ?? {}).length !== 1) {
        return fulfill(route, ASSOCIATE_SERVICE_RESPONSES.validationError);
      }
      const replay = keys.get(key);
      if (replay) {
        return replay.serviceId === serviceId
          ? fulfill(
              route,
              { status: 201, body: replay.association },
              { 'Idempotent-Replayed': 'true' },
            )
          : fulfill(route, ASSOCIATE_SERVICE_RESPONSES.idempotencyKeyReused);
      }
      const service = simulation.services.find(
        (item) => item.service_id === serviceId && item.category === 'SPORTS_MEDICINE',
      );
      if (!service) {
        return fulfill(route, ASSOCIATE_SERVICE_RESPONSES.serviceNotFound);
      }
      const active = simulation.associations.find(
        (item) => item.service_id === serviceId && item.status === 'ACTIVE',
      );
      if (active) {
        return fulfill(route, {
          status: 409,
          body: {
            ...ASSOCIATE_SERVICE_RESPONSES.associationExists.body,
            details: [{ field: 'association_id', issue: active.association_id }],
          },
        });
      }
      created += 1;
      const association: Association = {
        association_id: `9e1a3c5e-7a9c-4e1a-8c3e-${String(900 + created).padStart(12, '0')}`,
        service_id: service.service_id,
        service: {
          name: service.name,
          category: service.category,
          modality: service.modality,
          fee: service.price,
        },
        status: 'ACTIVE',
        associated_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
        ended_at: null,
        version: 1,
      };
      simulation.associations.unshift(association);
      keys.set(key, { serviceId, association });
      return fulfill(route, { status: 201, body: association });
    }

    const status = url.searchParams.get('status') ?? 'ACTIVE';
    if (!STATUSES.includes(status)) {
      return fulfill(route, SERVICE_ASSOCIATIONS_RESPONSES.validationError);
    }
    const matches = simulation.associations.filter(
      (item) => status === 'ALL' || item.status === status,
    );
    const limit = Number(url.searchParams.get('limit') ?? 20);
    const cursor = url.searchParams.get('cursor');
    const offset = cursor ? Number(atob(cursor).split(':')[1]) : 0;
    const more = offset + limit < matches.length;
    return fulfill(route, {
      status: 200,
      body: {
        items: matches.slice(offset, offset + limit),
        next_cursor: more ? btoa(`offset:${offset + limit}`) : null,
      },
    });
  };

  await page.route(
    (url) =>
      url.pathname === SERVICE_ASSOCIATIONS_PATH ||
      url.pathname.startsWith(`${SERVICE_ASSOCIATIONS_PATH}/`),
    handler,
  );
  return simulation;
}

async function fulfill(
  route: Route,
  response: SimulatedResponse,
  extraHeaders: Record<string, string> = {},
): Promise<void> {
  const origin = (await route.request().headerValue('origin')) ?? '';
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Expose-Headers': 'Idempotent-Replayed',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  };
  if (response.status === 204) {
    await route.fulfill({ status: 204, headers });
    return;
  }
  await route.fulfill({ status: response.status, json: response.body, headers });
}
