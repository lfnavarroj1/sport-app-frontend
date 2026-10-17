import { Page, Response, expect, test } from '@playwright/test';

/**
 * HU004 de punta a punta: Angular → BFF web → users-management, contra el
 * ambiente de `PLAYWRIGHT_BASE_URL`. Requiere `bff-web` 0.7.0 o una versión
 * compatible posterior (la operación no cambia hasta 0.13.0), `users-management`
 * 0.5.0 o posterior y que el origen de la aplicación esté en `CORS_ALLOWED_ORIGINS`
 * del BFF. Registra cuentas sintéticas con correos únicos.
 */

const PASSWORD = 'clave-sintetica-e2e-123';

const ACTORS = [
  { label: 'Deportista', home: /\/deportista\/inicio$/, area: '/deportista/inicio' },
  { label: 'Organizador de eventos', home: /\/organizador\/inicio$/, area: '/organizador/inicio' },
  {
    label: 'Profesional de servicios',
    home: /\/profesional\/inicio$/,
    area: '/profesional/inicio',
  },
] as const;

function uniqueEmail(): string {
  return `e2e-hu004-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

function waitForOperation(page: Page, path: string): Promise<Response> {
  return page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === path,
  );
}

async function registerAndLogin(page: Page, actor: (typeof ACTORS)[number]): Promise<void> {
  const email = uniqueEmail();
  await page.goto('/registro');
  await page.getByLabel('Nombre completo').fill('Persona Sintética E2E');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Tipo de usuario').click();
  await page.getByRole('option', { name: actor.label }).click();
  await page.getByLabel(/Acepto las políticas/).check();
  await page.getByRole('button', { name: 'Registrarme' }).click();
  await expect(page.getByRole('status')).toContainText(email);

  await page.goto('/iniciar-sesion');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).toHaveURL(actor.home);
}

/** Repite el cierre contra el BFF desde la página, sin cookie (CA2). */
async function revokeAgain(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const config = (await (await fetch('/app-config.json')).json()) as { bffWebBaseUrl: string };
    const response = await fetch(`${config.bffWebBaseUrl.replace(/\/+$/, '')}/v1/sessions/revoke`, {
      method: 'POST',
      credentials: 'include',
    });
    return response.status;
  });
}

test.describe('HU004 Cerrar sesión contra el BFF web @integrado', () => {
  test('CA1, CA2 y CA3: el deportista cierra sesión, repetir es seguro y la renovación se rechaza', async ({
    page,
  }) => {
    const athlete = ACTORS[0];
    await registerAndLogin(page, athlete);

    // CA1: el BFF revoca la familia y borra la cookie; la web vuelve al acceso.
    const revoked = waitForOperation(page, '/v1/sessions/revoke');
    await page.locator('mat-sidenav [data-menu-item="logout"]').click();
    expect((await revoked).status()).toBe(204);
    await expect(page).toHaveURL(/\/iniciar-sesion$/);
    await expect(page.getByTestId('login-logged-out')).toHaveText('Cerraste sesión.');

    // CA2: repetir el cierre ya sin sesión responde de forma segura.
    expect(await revokeAgain(page)).toBe(204);

    // CA3: al pedir el área protegida, la renovación se rechaza y se queda en el acceso.
    const refreshed = waitForOperation(page, '/v1/sessions/refresh');
    await page.goto(athlete.area);
    expect((await refreshed).status()).toBe(401);
    await expect(page).toHaveURL(/\/iniciar-sesion$/);
  });

  for (const actor of ACTORS.slice(1)) {
    test(`CA1: «${actor.label}» también cierra sesión desde la web`, async ({ page }) => {
      await registerAndLogin(page, actor);

      const revoked = waitForOperation(page, '/v1/sessions/revoke');
      await page.locator('mat-sidenav [data-menu-item="logout"]').click();
      expect((await revoked).status()).toBe(204);
      await expect(page).toHaveURL(/\/iniciar-sesion$/);

      const refreshed = waitForOperation(page, '/v1/sessions/refresh');
      await page.goto(actor.area);
      expect((await refreshed).status()).toBe(401);
      await expect(page).toHaveURL(/\/iniciar-sesion$/);
    });
  }
});
