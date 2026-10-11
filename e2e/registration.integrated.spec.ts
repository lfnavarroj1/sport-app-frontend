import { Page, expect, test } from '@playwright/test';

/**
 * HU001 de punta a punta: Angular → BFF web → users-management, contra el
 * ambiente de `PLAYWRIGHT_BASE_URL` (su `app-config.json` define el BFF y la
 * versión de políticas). Crea cuentas sintéticas con un correo único por ejecución.
 */

function uniqueEmail(): string {
  return `e2e-hu001-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function register(page: Page, email: string): Promise<void> {
  await page.goto('/registro');
  await page.getByLabel('Nombre completo').fill('Persona Sintética E2E');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill('clave-sintetica-e2e-123');
  await page.getByLabel('Tipo de usuario').click();
  await page.getByRole('option', { name: 'Deportista' }).click();
  await page.getByLabel(/Acepto las políticas/).check();
  await page.getByRole('button', { name: 'Registrarme' }).click();
}

test.describe('HU001 Registrar usuario contra el BFF web @integrado', () => {
  test('CA1 y CA2: registra una cuenta nueva y rechaza el mismo correo después', async ({
    page,
  }) => {
    const email = uniqueEmail();

    const created = page.waitForResponse(
      (response) => response.url().endsWith('/v1/users') && response.request().method() === 'POST',
    );
    await register(page, email);
    expect((await created).status()).toBe(201);
    await expect(page.getByRole('status')).toContainText(email);

    const duplicated = page.waitForResponse(
      (response) => response.url().endsWith('/v1/users') && response.request().method() === 'POST',
    );
    await register(page, email);
    expect((await duplicated).status()).toBe(409);
    await expect(page.getByText('Ya existe una cuenta con este correo electrónico.')).toBeVisible();
  });
});
