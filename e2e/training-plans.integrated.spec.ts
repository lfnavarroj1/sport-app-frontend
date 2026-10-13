import { Browser, Page, expect, test } from '@playwright/test';

/**
 * HU010 de punta a punta: Angular → BFF web → users-management (lookup por
 * correo) → training-management (escritura, outbox y proyección), contra el
 * ambiente de `PLAYWRIGHT_BASE_URL`. Requiere `bff-web` 0.6.0 o superior, el
 * plan `FREE` activo del deportista (capacidad `training.plan.manage`), el
 * proyector de lectura de Usuarios (`user_directory`) y el publicador y el
 * proyector de Entrenamientos. Registra cuentas sintéticas con correos únicos.
 */

const PASSWORD = 'clave-sintetica-e2e-123';

function uniqueEmail(role: string): string {
  return `e2e-hu010-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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

async function login(page: Page, email: string): Promise<void> {
  await page.goto('/iniciar-sesion');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Ingresar' }).click();
}

/** Cada actor usa su propio contexto: su cookie de sesión no se mezcla. */
async function newPage(browser: Browser): Promise<Page> {
  return (await browser.newContext()).newPage();
}

async function authorize(page: Page, athlete: string, professional: string): Promise<void> {
  await register(page, athlete, 'Deportista');
  await login(page, athlete);
  // El plan FREE se activa por mensajería (ADR-024): la opción aparece al confirmarse.
  const option = page.locator('mat-sidenav [data-menu-item="athlete-training-plans"]');
  await expect(option).toBeVisible({ timeout: 30_000 });
  await option.click();
  await page.getByLabel('Correo del profesional').fill(professional);
  const granted = page.waitForResponse(
    (r) => r.url().endsWith('/v1/me/training-authorizations') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Autorizar', exact: true }).click();
  expect((await granted).status()).toBe(201);
  await expect(page.getByTestId('authorization-notice')).toContainText(professional);
}

async function fillPlan(page: Page, athlete: string): Promise<void> {
  await page.getByLabel('Correo del deportista').fill(athlete);
  await page.getByLabel('Título').fill('Plan sintético E2E');
  await page.getByRole('textbox', { name: 'Objetivo 1' }).fill('Mejorar la resistencia');
  await page.getByLabel('Fecha de inicio').fill('2026-11-02');
  await page.getByLabel('Fecha de fin').fill('2026-11-29');
  await page.getByLabel('Fecha', { exact: true }).fill('2026-11-03');
  await page.getByLabel('Deporte').click();
  await page.getByRole('option', { name: 'Carrera' }).click();
  await page.getByLabel('Duración (min)').fill('45');
  await page.getByLabel('Intensidad (RPE)').fill('4');
  await page.getByRole('button', { name: 'Revisar plan' }).click();
}

async function confirm(page: Page): Promise<number> {
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/v1/training-plans') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Confirmar y asignar' }).click();
  return (await response).status();
}

test.describe('HU010 Crear plan de entrenamiento contra el BFF web @integrado', () => {
  test('CA1, CA4: el deportista autoriza y el profesional asigna y consulta el plan', async ({
    browser,
  }) => {
    const athleteEmail = uniqueEmail('deportista');
    const professionalEmail = uniqueEmail('profesional');
    const professional = await newPage(browser);
    await register(professional, professionalEmail, 'Profesional de servicios');

    await authorize(await newPage(browser), athleteEmail, professionalEmail);

    await login(professional, professionalEmail);
    await professional.locator('mat-sidenav [data-menu-item="training-plans"]').click();
    await fillPlan(professional, athleteEmail);
    expect(await confirm(professional)).toBe(201);
    await expect(professional.getByTestId('plan-created')).toContainText('Plan asignado');

    // CA4: la lectura es eventual; mientras se proyecta, la consulta responde 404.
    await professional.getByRole('link', { name: 'Consultar el plan' }).click();
    await expect(async () => {
      const retry = professional.getByTestId('plan-not-found').getByRole('button');
      if (await retry.isVisible()) {
        await retry.click();
      }
      await expect(professional.getByTestId('plan-summary-title')).toHaveText(
        'Plan sintético E2E',
        { timeout: 2_000 },
      );
    }).toPass({ timeout: 30_000 });
  });

  test('CA2: sin autorización del deportista la asignación se rechaza', async ({ page }) => {
    const professionalEmail = uniqueEmail('profesional');
    await register(page, professionalEmail, 'Profesional de servicios');
    await login(page, professionalEmail);
    await page.locator('mat-sidenav [data-menu-item="training-plans"]').click();

    await fillPlan(page, uniqueEmail('sin-autorizacion'));

    expect(await confirm(page)).toBe(403);
    await expect(page.locator('mat-error')).toContainText(
      'no corresponde a un deportista que te haya autorizado',
    );
  });
});
