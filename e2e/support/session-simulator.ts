import { Page, Request, Route } from '@playwright/test';

import {
  GET_CAPABILITIES_PATH,
  GET_CAPABILITIES_RESPONSES,
  capabilitiesFor,
} from '../../src/testing/bff-web/capabilities.fixtures';
import {
  CREATE_SESSION_PATH,
  CREATE_SESSION_RESPONSES,
} from '../../src/testing/bff-web/create-session.fixtures';
import {
  REFRESH_SESSION_PATH,
  REFRESH_SESSION_RESPONSES,
} from '../../src/testing/bff-web/refresh-session.fixtures';
import { SimulatedResponse } from '../../src/testing/bff-web/register-user.fixtures';

/** Cookie del refresh token según el contrato bff-web 0.10.0 (`Set-Cookie` de 200). */
export const REFRESH_COOKIE = '__Secure-sportapp_refresh';
const COOKIE_ATTRIBUTES = 'HttpOnly; Secure; Path=/v1/sessions; SameSite=Strict';

export interface SessionSimulation {
  /** Solicitudes recibidas en `POST /v1/sessions`. */
  readonly logins: Request[];
  /** Solicitudes recibidas en `POST /v1/sessions/refresh`. */
  readonly refreshes: Request[];
  /** Refresh tokens sintéticos emitidos en la cookie; rotan en cada renovación. */
  readonly refreshTokens: string[];
  /** Respuesta de la próxima renovación; por defecto, la que corresponde a la cookie. */
  nextRefresh: SimulatedResponse | null;
  /** Solicitudes recibidas en `GET /v1/me/capabilities`. */
  readonly capabilityRequests: Request[];
  /** Respuesta de `GET /v1/me/capabilities`; por defecto, la del actor de la sesión. */
  capabilities: SimulatedResponse | null;
}

/**
 * Reemplaza las operaciones de sesión del BFF con el simulador derivado del
 * contrato bff-web 0.10.0. Como el BFF real, `POST /v1/sessions` con `200` fija la
 * cookie HttpOnly del refresh token y `/refresh` la rota si el navegador la envía;
 * sin ella responde `401 invalid_refresh_token` y la borra. La cookie la guarda y
 * reenvía el navegador solo si la aplicación pide con credenciales.
 * `GET /v1/me/capabilities` responde la vista del actor de la sesión simulada.
 */
export async function simulateSession(
  page: Page,
  response: SimulatedResponse,
  headers: Record<string, string> = {},
): Promise<SessionSimulation> {
  const simulation: SessionSimulation = {
    logins: [],
    refreshes: [],
    refreshTokens: [],
    nextRefresh: null,
    capabilityRequests: [],
    capabilities: null,
  };

  await page.route(`**${CREATE_SESSION_PATH}`, async (route) => {
    if (route.request().method() !== 'POST') {
      return route.fallback();
    }
    simulation.logins.push(route.request());
    await fulfill(route, response, {
      ...headers,
      ...(response.status === 200 ? { 'Set-Cookie': issueCookie(simulation, response) } : {}),
    });
  });

  await page.route(`**${REFRESH_SESSION_PATH}`, async (route) => {
    if (route.request().method() !== 'POST') {
      return route.fallback();
    }
    simulation.refreshes.push(route.request());
    const cookie = await route.request().headerValue('cookie');
    const current = simulation.refreshTokens.at(-1);
    const hasCookie =
      current !== undefined && (cookie ?? '').includes(`${REFRESH_COOKIE}=${current}`);
    const refresh =
      simulation.nextRefresh ??
      (hasCookie
        ? {
            status: 200,
            body: { ...REFRESH_SESSION_RESPONSES.renewed.body, user: userOf(response) },
          }
        : REFRESH_SESSION_RESPONSES.invalidRefreshToken);
    simulation.nextRefresh = null;
    await fulfill(route, refresh, {
      'Set-Cookie':
        refresh.status === 200
          ? issueCookie(simulation, refresh)
          : `${REFRESH_COOKIE}=; ${COOKIE_ATTRIBUTES}; Max-Age=0`,
    });
  });

  // El usuario sale del access token, como en el BFF: sin Bearer → 401.
  await page.route(`**${GET_CAPABILITIES_PATH}`, async (route) => {
    if (route.request().method() !== 'GET') {
      return route.fallback();
    }
    simulation.capabilityRequests.push(route.request());
    const authorization = (await route.request().headerValue('authorization')) ?? '';
    const actorType = (userOf(response) as { actor_type?: string }).actor_type ?? '';
    const capabilities = /^Bearer \S+$/.test(authorization)
      ? (simulation.capabilities ?? capabilitiesFor(actorType))
      : GET_CAPABILITIES_RESPONSES.invalidAccessToken;
    await fulfill(route, capabilities, {});
  });

  return simulation;
}

/** CORS con credenciales: origen explícito, nunca `*` (contrato bff-web 0.4.0+). */
async function fulfill(
  route: Route,
  response: SimulatedResponse,
  headers: Record<string, string>,
): Promise<void> {
  const origin = (await route.request().headerValue('origin')) ?? '';
  await route.fulfill({
    status: response.status,
    json: response.body,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Expose-Headers': 'Retry-After',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

function issueCookie(simulation: SessionSimulation, response: SimulatedResponse): string {
  const token = `refresh-sintetico-${simulation.refreshTokens.length}-${Math.random().toString(36).slice(2)}`;
  simulation.refreshTokens.push(token);
  const maxAge = (response.body as { refresh_expires_in: number }).refresh_expires_in;
  return `${REFRESH_COOKIE}=${token}; ${COOKIE_ATTRIBUTES}; Max-Age=${maxAge}`;
}

function userOf(response: SimulatedResponse): unknown {
  return (
    (response.body as { user?: unknown }).user ?? CREATE_SESSION_RESPONSES.authenticated.body.user
  );
}

/**
 * BFF simulado sin sesión previa: `/refresh` responde `401 invalid_refresh_token`.
 * Toda página con guarda consulta `/refresh` al cargar; así la prueba no depende
 * de un BFF real que esté escuchando en la máquina.
 */
export function simulateNoSession(page: Page): Promise<SessionSimulation> {
  return simulateSession(page, CREATE_SESSION_RESPONSES.invalidCredentials);
}

/** Respuesta `200` del contrato con el `actor_type` indicado (o uno inválido). */
export function sessionFor(actorType: string): SimulatedResponse {
  const { body } = CREATE_SESSION_RESPONSES.authenticated;
  return { status: 200, body: { ...body, user: { ...body.user, actor_type: actorType } } };
}

export async function login(page: Page): Promise<void> {
  await page.goto('/iniciar-sesion');
  await page.getByLabel('Correo electrónico').fill('persona@example.com');
  await page.getByLabel('Contraseña', { exact: true }).fill('clave-sintetica-123');
  await page.getByRole('button', { name: 'Ingresar' }).click();
}
