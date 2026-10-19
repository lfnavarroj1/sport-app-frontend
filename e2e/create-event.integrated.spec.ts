import { Page, expect, test } from '@playwright/test';

/**
 * HU021 de punta a punta: Angular → BFF web → events-management, contra el
 * ambiente de `PLAYWRIGHT_BASE_URL`. Requiere `bff-web` 0.10.0 o superior y
 * `events-management` 0.2.0. Registra un organizador sintético con un correo
 * único por ejecución.
 */

const PASSWORD = 'clave-sintetica-e2e-123';

function uniqueEmail(): string {
  return `e2e-hu021-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

/** Una fecha futura (dentro de 30 días) en formato `YYYY-MM-DD`. */
function futureDate(days = 30): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

async function registerAndLogin(page: Page): Promise<void> {
  const email = uniqueEmail();
  await page.goto('/registro');
  await page.getByLabel('Nombre completo').fill('Persona Sintética E2E');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Tipo de usuario').click();
  await page.getByRole('option', { name: 'Organizador de eventos' }).click();
  await page.getByLabel(/Acepto las políticas/).check();
  await page.getByRole('button', { name: 'Registrarme' }).click();
  await expect(page.getByRole('status')).toContainText(email);

  await page.goto('/iniciar-sesion');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).toHaveURL(/\/organizador\/inicio$/);
}

async function fillEvent(page: Page, date: string): Promise<void> {
  await page.getByLabel('Nombre del evento').fill('Carrera sintética E2E');
  await page.getByLabel('Disciplina').fill('Running');
  await page
    .getByLabel('Descripción')
    .fill('Evento sintético creado por la prueba integrada de HU021.');
  await page.getByLabel('Nombre del lugar').fill('Parque de prueba');
  await page.getByLabel('Dirección').fill('Calle sintética 123');
  await page.getByLabel('Ciudad').fill('Bogotá');
  await page.getByLabel('País (código)').fill('CO');
  await page.getByLabel('Fecha de inicio').fill(date);
  await page.getByLabel('Hora de inicio').fill('07:00');
  await page.getByLabel('Zona horaria').fill('America/Bogota');
  await page.keyboard.press('Escape');
  await page.getByLabel('Duración (min)').fill('180');
  await page.getByLabel('Capacidad (personas)').fill('500');
}

async function create(page: Page): Promise<number> {
  const response = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/v1/events' && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Crear borrador' }).click();
  return (await response).status();
}

test.describe('HU021 Crear evento masivo contra el BFF web @integrado', () => {
  test('CA1: el organizador crea un borrador y ve la respuesta confirmada', async ({ page }) => {
    await registerAndLogin(page);
    await page.locator('mat-sidenav [data-menu-item="event-create"]').click();
    await fillEvent(page, futureDate());

    expect(await create(page)).toBe(201);
    await expect(page.getByTestId('event-created')).toContainText('Borrador creado');
    await expect(page.getByTestId('event-starts-at')).toContainText('7:00');
  });

  test('CA3: una fecha pasada se rechaza con la regla incumplida', async ({ page }) => {
    await registerAndLogin(page);
    await page.goto('/organizador/eventos/nuevo');
    await fillEvent(page, '2020-01-15');

    expect(await create(page)).toBe(422);
    await expect(page.getByTestId('event-errors')).toContainText('debe ser una fecha futura.');
    await expect(page.getByTestId('event-created')).toHaveCount(0);
  });
});
