import { Page, expect, test } from '@playwright/test';

/**
 * HU003 de punta a punta: Angular → BFF web → users-management, contra el
 * ambiente de `PLAYWRIGHT_BASE_URL`. Registra cuentas sintéticas (HU001) con un
 * correo único por ejecución y luego inicia sesión con ellas.
 */

const PASSWORD = 'clave-sintetica-e2e-123';

function uniqueEmail(): string {
  return `e2e-hu003-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function register(page: Page, email: string, actorLabel: string): Promise<void> {
  await page.goto('/registro');
  await page.getByLabel('Nombre completo').fill('Persona Sintética E2E');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Tipo de usuario').click();
  await page.getByRole('option', { name: actorLabel }).click();
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
    await register(page, email, 'Organizador de eventos');

    expect(await login(page, email, 'contrasena-incorrecta-123')).toBe(401);
    await expect(page.getByRole('alert')).toHaveText('Correo o contraseña incorrectos.');

    expect(await login(page, email, PASSWORD)).toBe(200);
    await expect(page).toHaveURL(/\/organizador\/inicio$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hola, Persona Sintética E2E');
  });

  test('CA2: un correo inexistente recibe el mismo mensaje genérico', async ({ page }) => {
    expect(await login(page, uniqueEmail(), PASSWORD)).toBe(401);
    await expect(page.getByRole('alert')).toHaveText('Correo o contraseña incorrectos.');
  });

  test('mantiene la sesión al recargar con la cookie HttpOnly del BFF', async ({ page }) => {
    const email = uniqueEmail();
    await register(page, email, 'Deportista');
    expect(await login(page, email, PASSWORD)).toBe(200);
    await expect(page).toHaveURL(/\/deportista\/inicio$/);

    const refresh = page.waitForResponse(
      (r) => r.url().endsWith('/v1/sessions/refresh') && r.request().method() === 'POST',
    );
    await page.reload();

    expect((await refresh).status()).toBe(200);
    await expect(page).toHaveURL(/\/deportista\/inicio$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hola, Persona Sintética E2E');
    const refreshCookie = (await page.context().cookies()).find(
      (cookie) => cookie.name === '__Secure-sportapp_refresh',
    );
    expect(refreshCookie?.httpOnly).toBe(true);
    expect(
      await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage })),
    ).not.toContain(refreshCookie?.value ?? '<sin cookie>');
  });

  test('renueva el access token antes de que venza y la sesión continúa', async ({ page }) => {
    // Solo el reloj de la página avanza; la cookie y el backend usan la hora real.
    await page.clock.install();
    const email = uniqueEmail();
    await register(page, email, 'Organizador de eventos');
    expect(await login(page, email, PASSWORD)).toBe(200);
    await expect(page).toHaveURL(/\/organizador\/inicio$/);

    const refresh = page.waitForResponse(
      (r) => r.url().endsWith('/v1/sessions/refresh') && r.request().method() === 'POST',
    );
    await page.clock.runFor('14:01');
    expect((await refresh).status()).toBe(200);

    await page.clock.runFor('02:00');
    await expect(page).toHaveURL(/\/organizador\/inicio$/);
  });

  test('sin cookie de sesión, la recarga lleva al inicio de sesión', async ({ page }) => {
    const refresh = page.waitForResponse(
      (r) => r.url().endsWith('/v1/sessions/refresh') && r.request().method() === 'POST',
    );
    await page.goto('/deportista/inicio');

    expect((await refresh).status()).toBe(401);
    await expect(page).toHaveURL(/\/iniciar-sesion$/);
  });

  // CA7–CA9, ADR-025 y ADR-024: cada actor real llega a su inicio, y su menú sale
  // de los permisos y capacidades que compone el BFF (`GET /v1/me/capabilities`).
  const actors = [
    {
      label: 'Deportista',
      home: /\/deportista\/inicio$/,
      shown: ['plan', 'athlete-training-plans', 'sport-calendar'],
      hidden: ['sports-medicine', 'event-create', 'service-create'],
    },
    {
      label: 'Organizador de eventos',
      home: /\/organizador\/inicio$/,
      shown: ['event-create', 'event-publish', 'integrated-calendar'],
      hidden: ['service-create', 'plan', 'athlete-training-plans'],
    },
    {
      label: 'Profesional de servicios',
      home: /\/profesional\/inicio$/,
      shown: ['service-create', 'service-publish', 'training-plans'],
      hidden: ['event-create', 'plan', 'athlete-training-plans'],
    },
  ];
  for (const actor of actors) {
    test(`CA7–CA9: «${actor.label}» entra a su inicio con el menú de sus permisos y su plan`, async ({
      page,
    }) => {
      const email = uniqueEmail();
      await register(page, email, actor.label);

      const capabilities = page.waitForResponse(
        (r) => r.url().endsWith('/v1/me/capabilities') && r.request().method() === 'GET',
      );
      expect(await login(page, email, PASSWORD)).toBe(200);
      expect((await capabilities).status()).toBe(200);

      await expect(page).toHaveURL(actor.home);
      await expect(page.getByTestId('shell-role')).toHaveText(actor.label);
      const menu = page.locator('mat-sidenav');
      for (const id of actor.shown) {
        // El plan FREE del deportista se activa por mensajería (ADR-024): mientras
        // tanto la web muestra PROVISIONING y vuelve a consultar.
        await expect(menu.locator(`[data-menu-item="${id}"]`)).toBeVisible({ timeout: 30_000 });
      }
      for (const id of actor.hidden) {
        await expect(menu.locator(`[data-menu-item="${id}"]`)).toHaveCount(0);
      }
    });
  }
});
