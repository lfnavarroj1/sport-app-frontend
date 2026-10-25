import { BrowserContext, Page, Request, Route } from '@playwright/test';

import {
  ACCOUNT_PATH,
  ACCOUNT_READ,
  GET_ACCOUNT_RESPONSES,
  PUT_ACCOUNT_RESPONSES,
} from '../../src/testing/bff-web/account.fixtures';
import { SimulatedResponse } from '../../src/testing/bff-web/register-user.fixtures';

export interface AccountState {
  fullName: string;
  email: string;
  actorType: string;
  version: number;
}

export interface AccountSimulation {
  /** Solicitudes recibidas en `PUT /v1/me/account`, en orden de llegada. */
  readonly requests: Request[];
  /** Solicitudes recibidas en `GET /v1/me/account`. */
  readonly reads: Request[];
  /** Respuestas de las próximas consultas, en orden; luego, la cuenta vigente. */
  readonly nextReads: SimulatedResponse[];
  /** Respuestas de los próximos `PUT`, en orden; luego, el comportamiento normal. */
  readonly next: SimulatedResponse[];
  /** Correos de otras cuentas: usarlos responde `409 email_already_registered` (CA3). */
  readonly takenEmails: Set<string>;
  /** Cuenta vigente (escritura); la consulta la devuelve sin retraso de proyección. */
  readonly state: AccountState;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ALLOWED_FIELDS = ['expected_version', 'full_name', 'email'];

/**
 * Reemplaza `GET` y `PUT /v1/me/account` con el simulador del contrato bff-web
 * 0.28.0 y ADR-035. Con el contexto como `target`, todas sus pestañas comparten
 * la misma cuenta (conflictos de versión entre pestañas).
 *
 * Como el BFF: sin `Bearer` responde `401`; el `PUT` exige `Idempotency-Key`
 * UUID; la misma clave con el mismo cuerpo devuelve la respuesta original con
 * `Idempotent-Replayed: true` y con otro cuerpo, `409 idempotency_key_reused`.
 * Solo se recuerdan las respuestas `200`. Cualquier campo distinto de
 * `expected_version`, `full_name` y `email` → `422 field_not_allowed` (CA2); el
 * nombre se recorta y colapsa sus espacios, y el correo se pasa a minúsculas. Un
 * correo de `takenEmails` → `409 email_already_registered` sin más datos (CA3);
 * una `expected_version` distinta de la vigente → `409 version_conflict` con la
 * versión vigente (CA4). Un correo igual al actual y el mismo nombre no crean
 * versión. Las demás situaciones se fuerzan con `next` y `nextReads`.
 */
export async function simulateAccount(
  target: Page | BrowserContext,
  actorType = 'athlete',
): Promise<AccountSimulation> {
  const simulation: AccountSimulation = {
    requests: [],
    reads: [],
    nextReads: [],
    next: [],
    takenEmails: new Set<string>(),
    state: {
      fullName: ACCOUNT_READ.full_name,
      email: ACCOUNT_READ.email,
      actorType,
      version: ACCOUNT_READ.version,
    },
  };
  const replays = new Map<string, { body: string; response: SimulatedResponse }>();
  let clock = Date.parse('2026-10-13T08:00:00Z');
  // Instantes sintéticos y crecientes, en UTC con `Z` y precisión de segundos.
  const now = () => new Date((clock += 60_000)).toISOString().replace('.000Z', 'Z');
  const account = () => ({
    user_id: ACCOUNT_READ.user_id,
    full_name: simulation.state.fullName,
    email: simulation.state.email,
    actor_type: simulation.state.actorType,
    status: 'active',
    version: simulation.state.version,
  });

  await target.route(`**${ACCOUNT_PATH}`, async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      simulation.reads.push(route.request());
      if (!(await authenticated(route))) {
        return fulfill(route, GET_ACCOUNT_RESPONSES.invalidAccessToken);
      }
      const queued = simulation.nextReads.shift();
      return fulfill(route, queued ?? { status: 200, body: { ...account(), projected_at: now() } });
    }
    if (method !== 'PUT') {
      return route.fallback();
    }

    simulation.requests.push(route.request());
    if (!(await authenticated(route))) {
      return fulfill(route, PUT_ACCOUNT_RESPONSES.invalidAccessToken);
    }
    const queued = simulation.next.shift();
    if (queued) {
      return fulfill(route, queued);
    }
    const key = (await route.request().headerValue('idempotency-key')) ?? '';
    if (!UUID.test(key)) {
      return fulfill(
        route,
        withDetails(PUT_ACCOUNT_RESPONSES.validationError, [
          { field: 'Idempotency-Key', issue: 'required' },
        ]),
      );
    }
    const body = route.request().postData() ?? '';
    const previous = replays.get(key);
    if (previous) {
      return previous.body === body
        ? fulfill(route, previous.response, { 'Idempotent-Replayed': 'true' })
        : fulfill(route, PUT_ACCOUNT_RESPONSES.idempotencyKeyReused);
    }

    const request = JSON.parse(body) as Record<string, unknown>;
    const violations = rejected(request);
    if (violations.length > 0) {
      return fulfill(route, withDetails(PUT_ACCOUNT_RESPONSES.validationError, violations));
    }
    if (request['expected_version'] !== simulation.state.version) {
      return fulfill(
        route,
        withDetails(PUT_ACCOUNT_RESPONSES.versionConflict, [
          { field: 'expected_version', issue: String(simulation.state.version) },
        ]),
      );
    }
    const fullName = (request['full_name'] as string).trim().replace(/\s+/g, ' ');
    const email = (request['email'] as string).trim().toLowerCase();
    if (simulation.takenEmails.has(email)) {
      return fulfill(route, PUT_ACCOUNT_RESPONSES.emailAlreadyRegistered);
    }
    if (fullName !== simulation.state.fullName || email !== simulation.state.email) {
      simulation.state.fullName = fullName;
      simulation.state.email = email;
      simulation.state.version += 1;
    }
    const response = { status: 200, body: { ...account(), updated_at: now() } };
    replays.set(key, { body, response });
    await fulfill(route, response);
  });

  return simulation;
}

/** Campos no permitidos (CA2), obligatorios y longitudes del contrato. */
function rejected(request: Record<string, unknown>): { field: string; issue: string }[] {
  const details = Object.keys(request)
    .filter((field) => !ALLOWED_FIELDS.includes(field))
    .map((field) => ({ field, issue: 'field_not_allowed' }));
  for (const field of ALLOWED_FIELDS) {
    if (!(field in request)) {
      details.push({ field, issue: 'required' });
    }
  }
  const fullName = String(request['full_name'] ?? '').trim();
  if ('full_name' in request && (fullName.length < 1 || fullName.length > 120)) {
    details.push({ field: 'full_name', issue: 'invalid_length' });
  }
  const email = String(request['email'] ?? '').trim();
  if ('email' in request && (email.length > 254 || !EMAIL.test(email))) {
    details.push({ field: 'email', issue: 'unknown_value' });
  }
  return details;
}

async function authenticated(route: Route): Promise<boolean> {
  const authorization = (await route.request().headerValue('authorization')) ?? '';
  return /^Bearer \S+$/.test(authorization);
}

function withDetails(
  response: SimulatedResponse,
  details: readonly { field: string | null; issue: string }[],
): SimulatedResponse {
  return { ...response, body: { ...(response.body as object), details } };
}

/** CORS con credenciales: origen explícito, nunca `*` (contrato bff-web 0.4.0+). */
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
      'Access-Control-Expose-Headers': 'Idempotent-Replayed',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}
