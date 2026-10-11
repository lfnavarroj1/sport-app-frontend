import { Page, Request } from '@playwright/test';

import {
  CREATE_SESSION_PATH,
  CREATE_SESSION_RESPONSES,
} from '../../src/testing/bff-web/create-session.fixtures';
import { SimulatedResponse } from '../../src/testing/bff-web/register-user.fixtures';

/**
 * Reemplaza `POST /v1/sessions` del BFF con una respuesta del simulador derivado
 * del contrato bff-web 0.3.0 y devuelve las solicitudes recibidas.
 */
export async function simulateSession(
  page: Page,
  response: SimulatedResponse,
  headers: Record<string, string> = {},
): Promise<Request[]> {
  const requests: Request[] = [];
  await page.route(`**${CREATE_SESSION_PATH}`, async (route) => {
    if (route.request().method() !== 'POST') {
      return route.fallback();
    }
    requests.push(route.request());
    await route.fulfill({
      status: response.status,
      json: response.body,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'Retry-After',
        ...headers,
      },
    });
  });
  return requests;
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
