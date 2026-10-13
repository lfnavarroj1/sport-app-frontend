import { Browser, Page, expect, test } from '@playwright/test';

/**
 * HU011 de punta a punta: Angular → BFF web → training-management (lectura
 * proyectada), contra el ambiente de `PLAYWRIGHT_BASE_URL`. Requiere `bff-web`
 * 0.8.0 o superior, el plan `FREE` activo del deportista, `usuarios-read-projector`
 * y el publicador y el proyector de Entrenamientos. Las sesiones terminadas nacen
 * en HU032 (aún sin implementar): hasta entonces el historial real está vacío y
 * este recorrido verifica CA2 y CA3; CA1 y CA4 quedan cubiertos con el simulador.
 */

const PASSWORD = 'clave-sintetica-e2e-123';

function uniqueEmail(role: string): string {
  return `e2e-hu011-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function newPage(browser: Browser): Promise<Page> {
  return (await browser.newContext()).newPage();
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

/** Crea un plan para el deportista (HU010) y devuelve la página en su resultado. */
async function assignPlan(page: Page, athleteEmail: string): Promise<void> {
  await page.locator('mat-sidenav [data-menu-item="training-plans"]').click();
  await page.getByLabel('Correo del deportista').fill(athleteEmail);
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
  await page.getByRole('button', { name: 'Confirmar y asignar' }).click();
  await expect(page.getByTestId('plan-created')).toBeVisible();
}

test.describe('HU011 Ver historial de entrenamiento contra el BFF web @integrado', () => {
  test('CA2: el deportista sin sesiones terminadas recibe la colección vacía', async ({ page }) => {
    const email = uniqueEmail('deportista');
    await register(page, email, 'Deportista');
    await login(page, email);
    const option = page.locator('mat-sidenav [data-menu-item="athlete-training-history"]');
    const response = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/v1/training-history',
    );
    await option.click();

    expect((await response).status()).toBe(200);
    await expect(page.getByTestId('state-empty')).toHaveText(
      'Aún no tienes entrenamientos terminados.',
    );
  });

  test('CA2 y CA3: el profesional autorizado consulta; tras la revocación, se rechaza', async ({
    browser,
  }) => {
    const athleteEmail = uniqueEmail('deportista');
    const professionalEmail = uniqueEmail('profesional');
    const professional = await newPage(browser);
    await register(professional, professionalEmail, 'Profesional de servicios');

    const athlete = await newPage(browser);
    await register(athlete, athleteEmail, 'Deportista');
    await login(athlete, athleteEmail);
    const plansOption = athlete.locator('mat-sidenav [data-menu-item="athlete-training-plans"]');
    await expect(plansOption).toBeVisible({ timeout: 30_000 });
    await plansOption.click();
    await athlete.getByLabel('Correo del profesional').fill(professionalEmail);
    await athlete.getByRole('button', { name: 'Autorizar', exact: true }).click();
    await expect(athlete.getByTestId('authorization-notice')).toContainText(professionalEmail);

    await login(professional, professionalEmail);
    await assignPlan(professional, athleteEmail);
    await professional.getByRole('link', { name: 'Ver historial de entrenamiento' }).click();
    // La autorización se proyecta de forma eventual (outbox → proyector).
    await expect(async () => {
      await professional.reload();
      await expect(professional.getByTestId('state-empty')).toHaveText(
        'Este deportista aún no tiene entrenamientos terminados.',
        { timeout: 2_000 },
      );
    }).toPass({ timeout: 30_000 });

    const entry = athlete.locator(`[data-professional="${professionalEmail}"]`);
    await entry.getByRole('button', { name: 'Revocar', exact: true }).click();
    await entry.getByRole('button', { name: 'Revocar autorización' }).click();
    await expect(entry).toContainText('Autorización revocada');

    await expect(async () => {
      await professional.reload();
      await expect(professional.getByTestId('history-not-authorized')).toBeVisible({
        timeout: 2_000,
      });
    }).toPass({ timeout: 30_000 });
  });
});
