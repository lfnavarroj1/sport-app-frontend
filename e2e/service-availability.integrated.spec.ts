import { Page, expect, test } from '@playwright/test';

/**
 * HU020 de punta a punta: Angular → BFF web → complementary-services (lectura
 * de disponibilidad), contra el ambiente de `PLAYWRIGHT_BASE_URL`. Requiere
 * `bff-web` 0.12.0 o superior (ADR-038). Un deportista recién registrado tiene
 * el plan `FREE` (o lo está activando): la consulta responde `200` y declara
 * medicina deportiva como categoría restringida. CA2–CA4 quedan cubiertos con el
 * simulador del contrato; aquí no se asume ningún servicio publicado.
 */

const PASSWORD = 'clave-sintetica-e2e-123';

function uniqueEmail(): string {
  return `e2e-hu020-deportista-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function register(page: Page, email: string): Promise<void> {
  await page.goto('/registro');
  await page.getByLabel('Nombre completo').fill('Persona Sintética E2E');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Tipo de usuario').click();
  await page.getByRole('option', { name: 'Deportista' }).click();
  await page.getByLabel(/Acepto las políticas/).check();
  await page.getByRole('button', { name: 'Registrarme' }).click();
  await expect(page.getByRole('status')).toContainText(email);
}

async function login(page: Page, email: string): Promise<void> {
  await page.goto('/iniciar-sesion');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).toHaveURL(/\/deportista\/inicio$/);
}

test.describe('HU020 Visualizar disponibilidad de servicios contra el BFF web @integrado', () => {
  test('CA1: el deportista FREE consulta el catálogo y ve medicina deportiva como restringida', async ({
    page,
  }) => {
    const email = uniqueEmail();
    await register(page, email);
    await login(page, email);

    const response = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/v1/services/availability',
    );
    await page.locator('mat-sidenav [data-menu-item="athlete-services"]').click();

    const availability = await response;
    expect(availability.status()).toBe(200);
    const query = new URL(availability.url()).searchParams;
    expect(query.get('from')).toMatch(/T00:00:00([+-]\d{2}:\d{2}|Z)$/);
    expect(query.get('availability')).toBe('available');
    expect(
      ((await availability.json()) as { restricted_categories: string[] }).restricted_categories,
    ).toContain('SPORTS_MEDICINE');
    await expect(page.getByTestId('availability-restricted')).toContainText('Medicina deportiva');
    await expect(page.getByTestId('state-error')).toHaveCount(0);
  });
});
