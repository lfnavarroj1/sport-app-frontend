import { Page, Request, Route } from '@playwright/test';

import { SimulatedResponse } from '../../src/testing/bff-web/register-user.fixtures';
import {
  MY_TEMPLATES_PATH,
  MY_TEMPLATES_RESPONSES,
  PUBLISH_TEMPLATE_RESPONSES,
  RETIRE_TEMPLATE_RESPONSES,
  SIMULATED_TEMPLATES_PROFESSIONAL_ID,
  TEMPLATES_PATH,
  professionalTemplate,
} from '../../src/testing/bff-web/training-templates.fixtures';

type TemplateDto = ReturnType<typeof professionalTemplate>;
interface Detail {
  readonly field: string;
  readonly issue: string;
}

export interface TrainingTemplatesSimulation {
  /** Plantillas del profesional, de la más reciente a la más antigua (orden del contrato). */
  templates: TemplateDto[];
  readonly listRequests: Request[];
  readonly publishRequests: Request[];
  readonly retireRequests: Request[];
  /** Respuestas de las próximas consultas de la lista, en orden; luego, lo normal. */
  readonly nextList: SimulatedResponse[];
  /** Respuestas de las próximas publicaciones, en orden; luego, lo normal. */
  readonly nextPublish: SimulatedResponse[];
  /**
   * Publicaciones que el BFF confirma pero cuya respuesta se pierde (`503`): la
   * plantilla queda creada y la misma clave repite el `201` con
   * `Idempotent-Replayed: true`. Se aplican después de `nextPublish`.
   */
  lostResponses: number;
}

const RETIRE_PATH = /^\/v1\/training-plan-templates\/([^/]+)\/retire$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_LIMIT = 20;

/**
 * Reemplaza `POST /v1/training-plan-templates`,
 * `POST /v1/training-plan-templates/{template_id}/retire` y
 * `GET /v1/me/training-plan-templates` con el simulador del contrato bff-web
 * 0.24.0 y ADR-041. Como el BFF: sin `Bearer` responde `401`; publicar exige
 * `Idempotency-Key` UUID y la misma clave con el mismo cuerpo repite la respuesta
 * con `Idempotent-Replayed: true` (con otro cuerpo, `409 idempotency_key_reused`);
 * las reglas del servicio responden `422` con `body.<campo>` y la sesión como
 * `weekly_sessions.N` (título 3–120 y objetivos 20–2000 recortados, semanas 1–52,
 * minutos 10–600 y descripción no vacía); la plantilla nace `PUBLISHED` en
 * versión 1 con el profesional del token. Retirar exige la versión vigente (`409
 * version_conflict` con la vigente), una plantilla ajena responde `404
 * template_not_found` y una ya retirada se devuelve tal cual. La lista pagina de
 * 20 en 20.
 */
export async function simulateTrainingTemplates(
  page: Page,
  templates: TemplateDto[] = [],
): Promise<TrainingTemplatesSimulation> {
  const simulation: TrainingTemplatesSimulation = {
    templates,
    listRequests: [],
    publishRequests: [],
    retireRequests: [],
    nextList: [],
    nextPublish: [],
    lostResponses: 0,
  };
  const replays = new Map<string, { body: string; response: SimulatedResponse }>();
  let clock = Date.parse('2026-10-24T16:00:00Z');
  const now = () => new Date((clock += 60_000)).toISOString().replace('.000Z', 'Z');

  const authorized = async (route: Route) =>
    /^Bearer \S+$/.test((await route.request().headerValue('authorization')) ?? '');

  await page.route(
    (url) => url.pathname === MY_TEMPLATES_PATH,
    async (route) => {
      if (route.request().method() !== 'GET') {
        return route.fallback();
      }
      simulation.listRequests.push(route.request());
      if (!(await authorized(route))) {
        return fulfill(route, MY_TEMPLATES_RESPONSES.invalidAccessToken);
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
        return fulfill(route, MY_TEMPLATES_RESPONSES.invalidCursor);
      }
      const end = start + limit;
      await fulfill(route, {
        status: 200,
        body: {
          items: simulation.templates.slice(start, end),
          next_cursor: end < simulation.templates.length ? `plantillas-desde-${end}` : null,
        },
      });
    },
  );

  await page.route(
    (url) => url.pathname === TEMPLATES_PATH,
    async (route) => {
      if (route.request().method() !== 'POST') {
        return route.fallback();
      }
      simulation.publishRequests.push(route.request());
      if (!(await authorized(route))) {
        return fulfill(route, PUBLISH_TEMPLATE_RESPONSES.invalidAccessToken);
      }
      const queued = simulation.nextPublish.shift();
      if (queued) {
        return fulfill(route, queued);
      }
      const key = (await route.request().headerValue('idempotency-key')) ?? '';
      if (!UUID.test(key)) {
        return fulfill(
          route,
          withDetails(PUBLISH_TEMPLATE_RESPONSES.validationError, [
            { field: 'Idempotency-Key', issue: 'required' },
          ]),
        );
      }
      const body = route.request().postData() ?? '';
      const previous = replays.get(key);
      if (previous) {
        return previous.body === body
          ? fulfill(route, previous.response, { 'Idempotent-Replayed': 'true' })
          : fulfill(route, PUBLISH_TEMPLATE_RESPONSES.idempotencyKeyReused);
      }
      const request = JSON.parse(body) as Record<string, unknown>;
      const violations = rejected(request);
      if (violations.length > 0) {
        return fulfill(route, withDetails(PUBLISH_TEMPLATE_RESPONSES.validationError, violations));
      }
      const instant = now();
      // Los datos de la plantilla son los de la solicitud (el `TemplateResponse` del contrato).
      const created = {
        ...professionalTemplate(0),
        ...request,
        template_id: crypto.randomUUID(),
        professional_id: SIMULATED_TEMPLATES_PROFESSIONAL_ID,
        status: 'PUBLISHED',
        version: 1,
        created_at: instant,
        updated_at: instant,
        published_at: instant,
        retired_at: null,
      } as TemplateDto;
      simulation.templates = [created, ...simulation.templates];
      const response = { status: 201, body: created };
      replays.set(key, { body, response });
      if (simulation.lostResponses > 0) {
        // Confirmada en el backend, pero la respuesta no llega al navegador.
        simulation.lostResponses--;
        return fulfill(route, PUBLISH_TEMPLATE_RESPONSES.upstreamUnavailable);
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
        return fulfill(route, RETIRE_TEMPLATE_RESPONSES.invalidAccessToken);
      }
      const id = decodeURIComponent(RETIRE_PATH.exec(new URL(route.request().url()).pathname)![1]);
      const current = simulation.templates.find((item) => item.template_id === id);
      if (!current) {
        return fulfill(route, RETIRE_TEMPLATE_RESPONSES.templateNotFound);
      }
      if (current.status === 'RETIRED') {
        return fulfill(route, { status: 200, body: current });
      }
      const expected = (route.request().postDataJSON() as { expected_version?: number })
        .expected_version;
      if (expected !== current.version) {
        return fulfill(
          route,
          withDetails(RETIRE_TEMPLATE_RESPONSES.versionConflict, [
            { field: 'expected_version', issue: String(current.version) },
          ]),
        );
      }
      const instant = now();
      const retired: TemplateDto = {
        ...current,
        status: 'RETIRED',
        version: current.version + 1,
        updated_at: instant,
        retired_at: instant,
      };
      simulation.templates = simulation.templates.map((item) =>
        item.template_id === id ? retired : item,
      );
      await fulfill(route, { status: 200, body: retired });
    },
  );

  return simulation;
}

/**
 * Reglas que el simulador reproduce (contrato 0.24.0 y ADR-041), con el prefijo
 * `body.` y los motivos de los fixtures: `invalid_length` y `out_of_range` del
 * servicio, `string_too_short` de la validación de forma.
 */
function rejected(request: Record<string, unknown>): Detail[] {
  const details: Detail[] = [];
  const title = String(request['title'] ?? '').trim();
  if (title.length < 3 || title.length > 120) {
    details.push({ field: 'body.title', issue: 'invalid_length' });
  }
  const objectives = String(request['objectives'] ?? '').trim();
  if (objectives.length < 20 || objectives.length > 2000) {
    details.push({ field: 'body.objectives', issue: 'invalid_length' });
  }
  if (!inRange(request['duration_weeks'], 1, 52)) {
    details.push({ field: 'body.duration_weeks', issue: 'out_of_range' });
  }
  const sessions =
    (request['weekly_sessions'] as
      { description?: string; duration_minutes?: unknown }[] | undefined) ?? [];
  sessions.forEach((session, index) => {
    if (!inRange(session.duration_minutes, 10, 600)) {
      details.push({
        field: `body.weekly_sessions.${index}.duration_minutes`,
        issue: 'out_of_range',
      });
    }
    if (String(session.description ?? '').trim() === '') {
      details.push({
        field: `body.weekly_sessions.${index}.description`,
        issue: 'string_too_short',
      });
    }
  });
  return details;
}

function inRange(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function position(cursor: string): number | null {
  const match = /^plantillas-desde-(\d+)$/.exec(cursor);
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
