import { Page, Request, Route, expect, test } from '@playwright/test';

import {
  REGISTER_USER_PATH,
  REGISTER_USER_RESPONSES,
  SIMULATED_CORRELATION_ID,
  SimulatedResponse,
} from '../src/testing/bff-web/register-user.fixtures';

/**
 * HU001 con el BFF reemplazado por el simulador derivado del contrato bff-web
 * 0.2.0. NO es E2E integrado: el recorrido real está en
 * `registration.integrated.spec.ts`.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Responde `POST /v1/users` con la secuencia indicada y guarda las solicitudes. */
async function simulateBff(page: Page, ...responses: SimulatedResponse[]): Promise<Request[]> {
  const requests: Request[] = [];
  await page.route(`**${REGISTER_USER_PATH}`, async (route: Route) => {
    if (route.request().method() !== 'POST') {
      return route.fallback();
    }
    requests.push(route.request());
    const response = responses[Math.min(requests.length, responses.length) - 1];
    await route.fulfill({
      status: response.status,
      json: response.body,
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  });
  return requests;
}

async function fillForm(page: Page, email = 'persona@example.com'): Promise<void> {
  await page.getByLabel('Nombre completo').fill('Persona Sintética');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill('clave-sintetica-123');
  await page.getByLabel('Tipo de usuario').click();
  await page.getByRole('option', { name: 'Deportista' }).click();
  await page.getByLabel(/Acepto las políticas/).check();
}

test.describe('HU001 Registrar usuario (simulador del contrato) @simulado', () => {
  test('se llega al registro desde el inicio de sesión', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/iniciar-sesion$/);

    await page.getByRole('link', { name: 'Crear cuenta' }).click();

    await expect(page).toHaveURL(/\/registro$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Crear cuenta' })).toBeVisible();
  });

  test('CA1: registra la cuenta, confirma el resultado y descarta la contraseña', async ({
    page,
  }) => {
    const requests = await simulateBff(page, REGISTER_USER_RESPONSES.registered);
    await page.goto('/registro');

    await fillForm(page);
    await page.getByRole('button', { name: 'Registrarme' }).click();

    const success = page.getByRole('status').filter({ hasText: 'Tu cuenta fue creada' });
    await expect(success).toContainText('persona@example.com');
    await expect(page.locator('input[type="password"]')).toHaveCount(0);

    expect(requests).toHaveLength(1);
    expect(requests[0].headers()['idempotency-key']).toMatch(UUID);
    expect(requests[0].postDataJSON()).toEqual({
      full_name: 'Persona Sintética',
      email: 'persona@example.com',
      password: 'clave-sintetica-123',
      actor_type: 'athlete',
      accepted_policies_version: 'local-dev',
    });
  });

  test('CA2: informa que el correo ya está registrado', async ({ page }) => {
    await simulateBff(page, REGISTER_USER_RESPONSES.emailAlreadyRegistered);
    await page.goto('/registro');

    await fillForm(page);
    await page.getByRole('button', { name: 'Registrarme' }).click();

    await expect(page.getByText('Ya existe una cuenta con este correo electrónico.')).toBeVisible();
    await expect(page.getByLabel('Correo electrónico')).toBeFocused();
    await expect(page.getByText('Tu cuenta fue creada')).toHaveCount(0);
  });

  test('CA3: identifica los campos inválidos sin llamar al BFF', async ({ page }) => {
    const requests = await simulateBff(page, REGISTER_USER_RESPONSES.registered);
    await page.goto('/registro');

    await page.getByRole('button', { name: 'Registrarme' }).click();

    await expect(page.getByText('Este campo es obligatorio.')).toHaveCount(4);
    await expect(page.getByText('Debes aceptar las políticas para registrarte.')).toBeVisible();
    await expect(page.getByLabel('Nombre completo')).toBeFocused();
    expect(requests).toHaveLength(0);
  });

  test('CA3: marca los campos que rechaza el backend', async ({ page }) => {
    await simulateBff(page, REGISTER_USER_RESPONSES.validationError);
    await page.goto('/registro');

    await fillForm(page);
    await page.getByRole('button', { name: 'Registrarme' }).click();

    await expect(page.getByText('El valor no es válido.')).toHaveCount(2);
  });

  test('CA5: un fallo del servicio es trazable y el reintento usa la misma clave', async ({
    page,
  }) => {
    const requests = await simulateBff(
      page,
      REGISTER_USER_RESPONSES.upstreamUnavailable,
      REGISTER_USER_RESPONSES.registered,
    );
    await page.goto('/registro');
    await fillForm(page);

    await page.getByRole('button', { name: 'Registrarme' }).click();
    const alert = page.getByRole('alert').filter({ hasText: 'El servicio no está disponible' });
    await expect(alert).toContainText(SIMULATED_CORRELATION_ID);

    await page.getByRole('button', { name: 'Registrarme' }).click();
    await expect(page.getByText('Tu cuenta fue creada')).toBeVisible();

    expect(requests).toHaveLength(2);
    expect(requests[1].headers()['idempotency-key']).toBe(requests[0].headers()['idempotency-key']);
  });
});
