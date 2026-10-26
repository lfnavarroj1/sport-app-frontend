import { Page, expect, test } from '@playwright/test';

/**
 * HU008 de punta a punta: Angular → BFF web → users-management (`PATCH` sobre el
 * agregado de HU006) y `usuarios-read-projector` (lectura del perfil), contra el
 * ambiente de `PLAYWRIGHT_BASE_URL`. Requiere `bff-web` 0.30.0 (con `PATCH` en
 * `CORS_ALLOWED_METHODS`) y `users-management` 0.14.0. Registra un deportista
 * sintético con un correo único por ejecución y sus hábitos con HU006.
 */

const PASSWORD = 'clave-sintetica-e2e-123';
const SPORT_HABITS_PATH = '/v1/me/sport-habits';
/** La lectura del perfil es una proyección: se espera a que alcance al comando. */
const PROJECTION = { timeout: 30_000, intervals: [1_000, 2_000, 5_000] };

function uniqueEmail(): string {
  return `e2e-hu008-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(page: Page): Promise<void> {
  const email = uniqueEmail();
  await page.goto('/registro');
  await page.getByLabel('Nombre completo').fill('Persona Sintética E2E');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Tipo de usuario').click();
  await page.getByRole('option', { name: 'Deportista' }).click();
  await page.getByLabel(/Acepto las políticas/).check();
  await page.getByRole('button', { name: 'Registrarme' }).click();
  await expect(page.getByRole('status')).toContainText(email);

  await page.goto('/iniciar-sesion');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).toHaveURL(/\/deportista\/inicio$/);
}

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const row = (page: Page, index: number) => page.getByTestId(`sport-row-${index}`);

async function choose(page: Page, index: number, label: string, option: string): Promise<void> {
  // Se pulsa el campo completo, como una persona: la etiqueta de un `mat-select` vacío
  // cubre el disparador y `mat-form-field` reenvía el clic al control.
  await row(page, index)
    .locator('mat-form-field', { has: page.getByLabel(label, { exact: true }) })
    .click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

/** Guarda los hábitos y devuelve el estado HTTP y el cuerpo enviado del comando. */
async function save(
  page: Page,
  method: 'PUT' | 'PATCH',
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = page.waitForResponse(
    (r) => new URL(r.url()).pathname === SPORT_HABITS_PATH && r.request().method() === method,
  );
  await button(page, 'Guardar hábitos deportivos').click();
  const received = await response;
  return {
    status: received.status(),
    body: received.request().postDataJSON() as Record<string, unknown>,
  };
}

/** Recarga hasta que la proyección muestre el texto en el elemento indicado. */
async function expectProjected(page: Page, testId: string, text: string): Promise<void> {
  await expect(async () => {
    await page.reload();
    await expect(page.getByTestId(testId)).toContainText(text, { timeout: 2_000 });
  }).toPass(PROJECTION);
}

/** Registra con HU006 dos deportes, lunes y sábado por la mañana y el objetivo «Salud». */
async function registerHabits(page: Page): Promise<void> {
  await page.goto('/deportista/perfil');
  await button(page, 'Registrar hábitos deportivos').click();
  await choose(page, 0, 'Deporte', 'Carrera');
  await row(page, 0).getByLabel('Veces por semana').fill('3');
  await row(page, 0).getByLabel('Duración por sesión (min)').fill('45');
  await choose(page, 0, 'Intensidad', 'Moderada');
  await choose(page, 0, 'Nivel', 'Intermedio');
  await button(page, 'Agregar deporte').click();
  await choose(page, 1, 'Deporte', 'Natación');
  await row(page, 1).getByLabel('Veces por semana').fill('1');
  await row(page, 1).getByLabel('Duración por sesión (min)').fill('60');
  await choose(page, 1, 'Intensidad', 'Baja');
  await choose(page, 1, 'Nivel', 'Principiante');
  await page.getByRole('checkbox', { name: 'Lunes' }).check();
  await page.getByRole('checkbox', { name: 'Sábado' }).check();
  await page.getByRole('checkbox', { name: 'Mañana' }).check();
  await page
    .locator('mat-form-field', { has: page.getByLabel('Objetivo principal (opcional)') })
    .click();
  await page.getByRole('option', { name: 'Salud', exact: true }).click();
  expect((await save(page, 'PUT')).status).toBe(201);
  await expectProjected(page, 'sport-habits-days', 'Sábado');
}

test.describe('HU008 Actualizar hábitos deportivos contra el BFF web @integrado', () => {
  test('CA1: edita un deporte sin perder la disponibilidad ni el objetivo', async ({ page }) => {
    await registerAndLogin(page);
    await registerHabits(page);

    await button(page, 'Editar hábitos deportivos').click();
    await row(page, 0).getByLabel('Veces por semana').fill('4');
    const result = await save(page, 'PATCH');

    expect(result.status).toBe(200);
    // Solo viaja la sección modificada.
    expect(Object.keys(result.body).sort()).toEqual(['expected_version', 'sports']);
    await expect(page.getByTestId('sport-habits-updated-sections')).toHaveText('Deportes');
    await expect(page.getByTestId('sport-habit-0')).toContainText('4 veces por semana');

    // Tras recargar, la proyección conserva lo no enviado.
    await expectProjected(page, 'sport-habit-0', '4 veces por semana');
    await expect(page.getByTestId('sport-habit-1')).toContainText('Natación');
    await expect(page.getByTestId('sport-habits-days')).toHaveText(/Lunes\s*Sábado/);
    await expect(page.getByTestId('sport-habits-time-slots')).toHaveText('Mañana');
    await expect(page.getByTestId('sport-habits-goal')).toHaveText('Salud');
  });

  test('CA2: un conflicto desde dos pestañas no sobrescribe', async ({ page }) => {
    await registerAndLogin(page);
    await registerHabits(page);

    // La segunda pestaña carga la versión 1 antes de la edición de la primera.
    const other = await page.context().newPage();
    await other.goto('/deportista/perfil');
    await expect(other.getByTestId('sport-habit-0')).toContainText('3 veces por semana');

    await button(page, 'Editar hábitos deportivos').click();
    await row(page, 0).getByLabel('Veces por semana').fill('5');
    expect((await save(page, 'PATCH')).status).toBe(200);

    await button(other, 'Editar hábitos deportivos').click();
    await other.getByRole('checkbox', { name: 'Martes' }).check();
    const rejected = await save(other, 'PATCH');
    expect(rejected.status).toBe(409);
    expect(rejected.body['expected_version']).toBe(1);
    await expect(other.getByTestId('sport-habits-conflict')).toContainText(
      'cambiaron en otra sesión y no se sobrescribieron',
    );
    // El valor vigente es el de la primera pestaña; el cambio rechazado no se aplicó.
    await expectProjected(other, 'sport-habit-0', '5 veces por semana');
    await expect(other.getByTestId('sport-habits-days')).not.toContainText('Martes');
  });
});
