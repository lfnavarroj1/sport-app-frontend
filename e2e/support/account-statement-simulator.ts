import { BrowserContext, Page, Request, Route } from '@playwright/test';

import {
  ACCOUNT_STATEMENT_PATH,
  ACCOUNT_STATEMENT_RESPONSES,
  FREE_ACTIVATED_MOVEMENT,
  PENDING_COMMITMENT,
  WAIVED_COMMITMENT,
  offsetOfCursor,
  statementPage,
  statementResponse,
} from '../../src/testing/bff-web/account-statement.fixtures';
import { FREE_SUBSCRIPTION } from '../../src/testing/bff-web/affiliation.fixtures';
import { SimulatedResponse } from '../../src/testing/bff-web/register-user.fixtures';
import { AffiliationSimulation } from './affiliation-simulator';

type Statement = Parameters<typeof statementPage>;

/** Datos del estado de cuenta de quien consulta, en el orden del contrato. */
export interface StatementData {
  readonly status: 'ACTIVE' | 'PROVISIONING' | 'NOT_APPLICABLE' | 'NONE';
  readonly subscription: Statement[1];
  readonly commitments: Statement[2];
  readonly movements: Statement[3];
}

export interface AccountStatementSimulation {
  /** Estado de cuenta vigente; se lee en cada consulta. */
  data: () => StatementData;
  readonly requests: Request[];
  /** Respuestas de las próximas consultas, en orden; luego, el comportamiento normal. */
  readonly next: SimulatedResponse[];
}

/** Deportista recién registrado: `FREE` activo, sin compromisos. */
export const ACTIVE_FREE_DATA: StatementData = {
  status: 'ACTIVE',
  subscription: FREE_SUBSCRIPTION,
  commitments: [],
  movements: [FREE_ACTIVATED_MOVEMENT],
};

/** Organizador y profesional: `NOT_APPLICABLE` con listas vacías (CA2). */
export const NOT_APPLICABLE_DATA: StatementData = {
  status: 'NOT_APPLICABLE',
  subscription: null,
  commitments: [],
  movements: [],
};

/**
 * Estado de cuenta del deportista derivado de la suscripción de
 * `simulateAffiliation`, como lo compone Afiliación: el alta `FREE`; tras pasar a
 * un plan pago, el cambio y su compromiso `PENDING_EXTERNAL`; y al volver a
 * `FREE`, el regreso y el compromiso `WAIVED`. Sin suscripción: `PROVISIONING`.
 */
export function athleteDataFrom(affiliation: AffiliationSimulation): () => StatementData {
  let paidSeen = false;
  return () => {
    const subscription = affiliation.subscription;
    if (subscription === null) {
      return { status: 'PROVISIONING', subscription: null, commitments: [], movements: [] };
    }
    const paid = subscription.periodicity !== 'NONE';
    paidSeen ||= paid;
    const body = paid
      ? ACCOUNT_STATEMENT_RESPONSES.activePremium.body
      : paidSeen
        ? ACCOUNT_STATEMENT_RESPONSES.backToFree.body
        : ACCOUNT_STATEMENT_RESPONSES.activeFree.body;
    return {
      status: 'ACTIVE',
      subscription,
      commitments: paid ? [PENDING_COMMITMENT] : paidSeen ? [WAIVED_COMMITMENT] : [],
      movements: paidSeen ? body.movements : [FREE_ACTIVATED_MOVEMENT],
    };
  };
}

/**
 * Reemplaza `GET /v1/me/account-statement` con el simulador del contrato bff-web
 * 0.28.0 (ADR-036); con el contexto como `target`, en todas sus pestañas. Como el BFF: sin `Bearer`
 * responde `401`; `limit` fuera de 1 a 100 o un cursor que no emitió, `422`; pagina
 * por cursor en el orden de los datos; `payments_status` es `NOT_INTEGRATED` y
 * `balance`, `null`. La cuenta es la de la sesión: no hay parámetro de usuario.
 */
export async function simulateAccountStatement(
  target: Page | BrowserContext,
  data: () => StatementData,
): Promise<AccountStatementSimulation> {
  const simulation: AccountStatementSimulation = { data, requests: [], next: [] };

  await target.route((url) => url.pathname === ACCOUNT_STATEMENT_PATH, async (route) => {
    if (route.request().method() !== 'GET') {
      return route.fallback();
    }
    simulation.requests.push(route.request());
    const authorization = (await route.request().headerValue('authorization')) ?? '';
    if (!/^Bearer \S+$/.test(authorization)) {
      return fulfill(route, ACCOUNT_STATEMENT_RESPONSES.invalidAccessToken);
    }
    const injected = simulation.next.shift();
    if (injected) {
      return fulfill(route, injected);
    }
    const query = new URL(route.request().url()).searchParams;
    const limit = Number(query.get('limit') ?? '20');
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return fulfill(route, ACCOUNT_STATEMENT_RESPONSES.limitOutOfRange);
    }
    const cursor = query.get('cursor');
    const offset = cursor === null ? 0 : offsetOfCursor(cursor);
    if (offset === null) {
      return fulfill(route, ACCOUNT_STATEMENT_RESPONSES.invalidCursor);
    }
    const current = simulation.data();
    const body =
      current.status === 'ACTIVE' || current.status === 'NONE'
        ? statementPage(
            current.status,
            current.subscription,
            current.commitments,
            current.movements,
            offset,
            limit,
          )
        : statementResponse(current.status, null, [], []);
    await fulfill(route, { status: 200, body });
  });

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
