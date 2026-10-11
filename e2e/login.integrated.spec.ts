import { Page, expect, test } from '@playwright/test';

/**
 * HU003 de punta a punta: Angular → BFF web → users-management, contra el
 * ambiente de `PLAYWRIGHT_BASE_URL`. Registra una cuenta sintética (HU001) con un
 * correo único por ejecución y luego inicia sesión con ella.
 */

const PASSWORD = 'clave-sintetica-e2e-123';

function uniqueEmail(): string {
  return `e2e-hu003-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function register(page: Page, email: string): Promise<void> {
  await page.goto('/registro');
  await page.getByLabel('Nombre completo').fill('Persona Sintética E2E');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Tipo de usuario').click();
  await page.getByRole('option', { name: 'Organizador de eventos' }).click();
  await page.getByLabel(/Acepto las políticas/).check();
  await page.getByRole('button', { name: 'Registrarme' }).click();
  await expect(page.getByRole('status')).toContainText(email);
}

async function login(page: Page, email: string, password: string): Promise<number> {
  await page.goto('/iniciar-sesion');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/v1/sessions') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Ingresar' }).click();
  return (await response).status();
}

test.describe('HU003 Iniciar sesión contra el BFF web @integrado', () => {
  test('CA1 y CA2: rechaza una contraseña incorrecta y luego ingresa con la correcta', async ({
    page,
  }) => {
    const email = uniqueEmail();
    await register(page, email);

    expect(await login(page, email, 'contrasena-incorrecta-123')).toBe(401);
    await expect(page.getByRole('alert')).toHaveText('Correo o contraseña incorrectos.');

    expect(await login(page, email, PASSWORD)).toBe(200);
    await expect(page).toHaveURL(/\/inicio$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hola, Persona Sintética E2E');
    await expect(page.getByTestId('home-actor-type')).toHaveText('Organizador de eventos');
  });

  test('CA2: un correo inexistente recibe el mismo mensaje genérico', async ({ page }) => {
    expect(await login(page, uniqueEmail(), PASSWORD)).toBe(401);
    await expect(page.getByRole('alert')).toHaveText('Correo o contraseña incorrectos.');
  });
});
