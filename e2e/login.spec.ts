import { Page, Request, expect, test } from '@playwright/test';

import {
  CREATE_SESSION_PATH,
  CREATE_SESSION_RESPONSES,
  SIMULATED_ACCESS_TOKEN,
  SIMULATED_REFRESH_TOKEN,
  SIMULATED_RETRY_AFTER,
} from '../src/testing/bff-web/create-session.fixtures';
import { SimulatedResponse } from '../src/testing/bff-web/register-user.fixtures';

/**
 * HU003 con el BFF reemplazado por el simulador derivado del contrato bff-web
 * 0.3.0. NO es E2E integrado: el recorrido real está en `login.integrated.spec.ts`.
 */

async function simulateBff(
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

async function login(page: Page): Promise<void> {
  await page.goto('/iniciar-sesion');
  await page.getByLabel('Correo electrónico').fill('persona@example.com');
  await page.getByLabel('Contraseña', { exact: true }).fill('clave-sintetica-123');
  await page.getByRole('button', { name: 'Ingresar' }).click();
}

test.describe('HU003 Iniciar sesión (simulador del contrato) @simulado', () => {
  test('es la página inicial y desde ella se llega al registro', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveURL(/\/iniciar-sesion$/);
    await page.getByRole('link', { name: 'Crear cuenta' }).click();
    await expect(page).toHaveURL(/\/registro$/);
    await page.getByRole('link', { name: 'Inicia sesión' }).click();
    await expect(page).toHaveURL(/\/iniciar-sesion$/);
  });

  test('CA1: inicia sesión, redirige al inicio y no persiste tokens', async ({ page }) => {
    const requests = await simulateBff(page, CREATE_SESSION_RESPONSES.authenticated);

    await login(page);

    await expect(page).toHaveURL(/\/inicio$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hola, Persona Sintética');
    await expect(page.getByTestId('home-actor-type')).toHaveText('Organizador de eventos');
    await expect(page.getByTestId('session-user')).toHaveText('Persona Sintética');
    expect(requests[0].postDataJSON()).toEqual({
      email: 'persona@example.com',
      password: 'clave-sintetica-123',
    });

    const stored = await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage, cookies: document.cookie }),
    );
    expect(stored).not.toContain(SIMULATED_ACCESS_TOKEN);
    expect(stored).not.toContain(SIMULATED_REFRESH_TOKEN);

    // Con sesión vigente, el formulario de acceso lleva directo al inicio.
    await page.getByRole('navigation').getByRole('link', { name: 'Inicio' }).click();
    await page.evaluate(() => history.pushState({}, '', '/iniciar-sesion'));
    await page.goBack();
    await expect(page).toHaveURL(/\/inicio$/);
  });

  test('la sesión vive solo en memoria: al recargar hay que ingresar de nuevo', async ({
    page,
  }) => {
    await simulateBff(page, CREATE_SESSION_RESPONSES.authenticated);
    await login(page);
    await expect(page).toHaveURL(/\/inicio$/);

    await page.reload();

    await expect(page).toHaveURL(/\/iniciar-sesion$/);
  });

  test('CA2/CA3: credenciales rechazadas → mensaje genérico, sin sesión', async ({ page }) => {
    await simulateBff(page, CREATE_SESSION_RESPONSES.invalidCredentials);

    await login(page);

    await expect(page.getByRole('alert')).toHaveText('Correo o contraseña incorrectos.');
    await expect(page.getByLabel('Contraseña', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('Contraseña', { exact: true })).toBeFocused();
    await expect(page).toHaveURL(/\/iniciar-sesion$/);
  });

  test('CA4: demasiados intentos → informa la espera indicada por el BFF', async ({ page }) => {
    await simulateBff(page, CREATE_SESSION_RESPONSES.tooManyAttempts, {
      'Retry-After': String(SIMULATED_RETRY_AFTER),
    });

    await login(page);

    await expect(page.getByRole('alert')).toHaveText(
      'Hiciste demasiados intentos. Intenta de nuevo en 10 min.',
    );
  });

  test('el inicio exige una sesión vigente', async ({ page }) => {
    await page.goto('/inicio');

    await expect(page).toHaveURL(/\/iniciar-sesion$/);
  });
});
