import { Page, Request, Route } from '@playwright/test';

import { SimulatedResponse } from '../../src/testing/bff-web/register-user.fixtures';
import {
  CREATE_TRAINING_PLAN_RESPONSES,
  GET_TRAINING_PLAN_RESPONSES,
  GRANT_AUTHORIZATION_RESPONSES,
  REVOKE_AUTHORIZATION_RESPONSES,
  TRAINING_AUTHORIZATIONS_PATH,
  TRAINING_PLANS_PATH,
} from '../../src/testing/bff-web/training.fixtures';

export interface TrainingSimulation {
  readonly grants: Request[];
  readonly revokes: Request[];
  readonly creates: Request[];
  readonly reads: Request[];
  /** Respuesta de la próxima solicitud de cada operación; luego vuelve al comportamiento normal. */
  nextGrant: SimulatedResponse | null;
  nextRevoke: SimulatedResponse | null;
  nextCreate: SimulatedResponse | null;
  nextRead: SimulatedResponse | null;
}

/**
 * Reemplaza las operaciones de HU010 del BFF con el simulador derivado del
 * contrato bff-web 0.13.0. Como el BFF real: sin `Authorization: Bearer` responde
 * `401 invalid_access_token`; `POST /v1/training-plans` exige `Idempotency-Key`
 * y, si la clave se repite, devuelve el mismo plan con `Idempotent-Replayed: true`;
 * el plan creado se puede consultar por su identificador.
 */
export async function simulateTraining(page: Page): Promise<TrainingSimulation> {
  const simulation: TrainingSimulation = {
    grants: [],
    revokes: [],
    creates: [],
    reads: [],
    nextGrant: null,
    nextRevoke: null,
    nextCreate: null,
    nextRead: null,
  };
  const plansByKey = new Map<string, object>();

  await page.route(`**${TRAINING_AUTHORIZATIONS_PATH}`, async (route) => {
    if (route.request().method() !== 'POST') {
      return route.fallback();
    }
    simulation.grants.push(route.request());
    const response =
      (await unauthenticated(route)) ??
      take(simulation, 'nextGrant') ??
      GRANT_AUTHORIZATION_RESPONSES.granted;
    await fulfill(route, response);
  });

  await page.route(`**${TRAINING_AUTHORIZATIONS_PATH}/*`, async (route) => {
    if (route.request().method() !== 'DELETE') {
      return route.fallback();
    }
    simulation.revokes.push(route.request());
    const response =
      (await unauthenticated(route)) ??
      take(simulation, 'nextRevoke') ??
      REVOKE_AUTHORIZATION_RESPONSES.revoked;
    await fulfill(route, response);
  });

  await page.route(`**${TRAINING_PLANS_PATH}`, async (route) => {
    if (route.request().method() !== 'POST') {
      return route.fallback();
    }
    simulation.creates.push(route.request());
    const rejected = (await unauthenticated(route)) ?? take(simulation, 'nextCreate');
    if (rejected) {
      return fulfill(route, rejected);
    }
    const key = (await route.request().headerValue('idempotency-key')) ?? '';
    const replayed = plansByKey.get(key);
    if (replayed) {
      return fulfill(route, { status: 201, body: replayed }, { 'Idempotent-Replayed': 'true' });
    }
    // El plan creado conserva lo que envió el cliente, con los identificadores del simulador.
    const request = route.request().postDataJSON() as Record<string, unknown>;
    const plan = {
      ...CREATE_TRAINING_PLAN_RESPONSES.created.body,
      title: request['title'],
      objectives: request['objectives'],
      start_date: request['start_date'],
      end_date: request['end_date'],
      sessions: request['sessions'],
    };
    plansByKey.set(key, plan);
    await fulfill(route, { status: 201, body: plan });
  });

  await page.route(`**${TRAINING_PLANS_PATH}/*`, async (route) => {
    if (route.request().method() !== 'GET') {
      return route.fallback();
    }
    simulation.reads.push(route.request());
    const planId = new URL(route.request().url()).pathname.split('/').pop();
    const plan = [...plansByKey.values()].find(
      (item) => (item as { plan_id: string }).plan_id === planId,
    );
    const response =
      (await unauthenticated(route)) ??
      take(simulation, 'nextRead') ??
      (plan ? { status: 200, body: plan } : GET_TRAINING_PLAN_RESPONSES.trainingPlanNotFound);
    await fulfill(route, response);
  });

  return simulation;
}

function take(
  simulation: TrainingSimulation,
  key: 'nextGrant' | 'nextRevoke' | 'nextCreate' | 'nextRead',
): SimulatedResponse | null {
  const response = simulation[key];
  simulation[key] = null;
  return response;
}

async function unauthenticated(route: Route): Promise<SimulatedResponse | null> {
  const authorization = (await route.request().headerValue('authorization')) ?? '';
  return /^Bearer \S+$/.test(authorization)
    ? null
    : CREATE_TRAINING_PLAN_RESPONSES.invalidAccessToken;
}

/** CORS como el BFF: origen explícito y cabeceras de idempotencia expuestas. */
async function fulfill(
  route: Route,
  response: SimulatedResponse,
  headers: Record<string, string> = {},
): Promise<void> {
  const origin = (await route.request().headerValue('origin')) ?? '';
  await route.fulfill({
    status: response.status,
    ...(response.body === null ? { body: '' } : { json: response.body }),
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Expose-Headers': 'Location, Idempotent-Replayed, X-Correlation-ID',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}
