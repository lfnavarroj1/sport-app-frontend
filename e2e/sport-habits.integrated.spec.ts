import { Page, expect, test } from '@playwright/test';

/**
 * HU006 de punta a punta: Angular → BFF web → users-management (comando) y
 * `usuarios-read-projector` (lectura del perfil), contra el ambiente de
 * `PLAYWRIGHT_BASE_URL`. Requiere `bff-web` 0.19.0 o superior,
 * `users-management` 0.9.0 con la migración `0005_sport_habits` y el
 * proyector que aplica `habitos.deportivos_actualizados.v1`. Registra un
 * deportista sintético con un correo único por ejecución.
 */

const PASSWORD = 'clave-sintetica-e2e-123';
const SPORT_HABITS_PATH = '/v1/me/sport-habits';
/** La lectura del perfil es una proyección: se espera a que alcance al comando. */
const PROJECTION = { timeout: 30_000, intervals: [1_000, 2_000, 5_000] };

function uniqueEmail(): string {
  return `e2e-hu006-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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

/**
 * Guarda los hábitos y devuelve el estado HTTP del comando: `PUT` al registrar y,
 * desde HU008, `PATCH` al editar unos hábitos ya registrados.
 */
async function save(page: Page, method: 'PUT' | 'PATCH' = 'PUT'): Promise<number> {
  const response = page.waitForResponse(
    (r) => new URL(r.url()).pathname === SPORT_HABITS_PATH && r.request().method() === method,
  );
  await button(page, 'Guardar hábitos deportivos').click();
  return (await response).status();
}

/** Recarga hasta que la proyección muestre el texto en el elemento indicado. */
async function expectProjected(page: Page, testId: string, text: string): Promise<void> {
  await expect(async () => {
    await page.reload();
    await expect(page.getByTestId(testId)).toContainText(text, { timeout: 2_000 });
  }).toPass(PROJECTION);
}

test.describe('HU006 Hábitos deportivos contra el BFF web @integrado', () => {
  test('CA1 y CA4: registra los hábitos, los ve tras recargar y un reemplazo viejo no sobrescribe', async ({
    page,
  }) => {
    await registerAndLogin(page);
    await page.locator('mat-sidenav [data-menu-item="profile"]').click();
    await expect(page).toHaveURL(/\/deportista\/perfil$/);
    await expect(page.getByTestId('sport-habits-empty')).toBeVisible();

    // CA1: 201 con la representación normalizada (deportes en el orden del catálogo).
    await button(page, 'Registrar hábitos deportivos').click();
    await choose(page, 0, 'Deporte', 'Natación');
    await row(page, 0).getByLabel('Veces por semana').fill('2');
    await row(page, 0).getByLabel('Duración por sesión (min)').fill('60');
    await choose(page, 0, 'Intensidad', 'Baja');
    await choose(page, 0, 'Nivel', 'Principiante');
    await button(page, 'Agregar deporte').click();
    await choose(page, 1, 'Deporte', 'Carrera');
    await row(page, 1).getByLabel('Veces por semana').fill('3');
    await row(page, 1).getByLabel('Duración por sesión (min)').fill('45');
    await choose(page, 1, 'Intensidad', 'Moderada');
    await choose(page, 1, 'Nivel', 'Intermedio');
    await row(page, 1).getByLabel('Años practicándolo (opcional)').fill('4');
    await page.getByRole('checkbox', { name: 'Sábado' }).check();
    await page.getByRole('checkbox', { name: 'Lunes' }).check();
    await page.getByRole('checkbox', { name: 'Mañana' }).check();
    expect(await save(page)).toBe(201);
    await expect(page.getByTestId('sport-habits-saved')).toHaveText(
      'Registramos tus hábitos deportivos.',
    );
    await expect(page.getByTestId('sport-habit-0')).toContainText('Carrera');
    await expect(page.getByTestId('sport-habit-1')).toContainText('Natación');

    // Tras recargar, los hábitos llegan de la proyección (`GET /v1/me/profile`).
    await expectProjected(page, 'sport-habits-days', 'Sábado');
    await expect(page.getByTestId('sport-habit-0')).toContainText('4 años practicándolo');

    // CA4: la segunda pestaña carga la versión 1 antes del reemplazo de la primera.
    const other = await page.context().newPage();
    await other.goto('/deportista/perfil');
    await expect(other.getByTestId('sport-habit-0')).toContainText('3 veces por semana');

    await button(page, 'Editar hábitos deportivos').click();
    await row(page, 0).getByLabel('Veces por semana').fill('5');
    expect(await save(page, 'PATCH')).toBe(200);
    // Desde HU008 la edición envía solo los deportes (PATCH); la confirmación los lista.
    await expect(page.getByTestId('sport-habits-saved')).toHaveText(
      /^Actualizamos tus hábitos deportivos\.\s*Secciones actualizadas:\s*Deportes\s*Lo que no cambiaste se conservó\.$/,
    );

    await button(other, 'Editar hábitos deportivos').click();
    await row(other, 0).getByLabel('Veces por semana').fill('1');
    expect(await save(other, 'PATCH')).toBe(409);
    await expect(other.getByTestId('sport-habits-conflict')).toContainText(
      'cambiaron en otra sesión y no se sobrescribieron',
    );
    // El valor vigente es el de la primera pestaña, no el del reemplazo rechazado.
    await expectProjected(other, 'sport-habit-0', '5 veces por semana');
  });

  test('CA2: un 422 del backend se marca en la fila y no cambia los hábitos', async ({ page }) => {
    await registerAndLogin(page);
    await page.goto('/deportista/perfil');
    await button(page, 'Registrar hábitos deportivos').click();
    await choose(page, 0, 'Deporte', 'Ciclismo');
    await row(page, 0).getByLabel('Veces por semana').fill('3');
    await row(page, 0).getByLabel('Duración por sesión (min)').fill('90');
    await choose(page, 0, 'Intensidad', 'Alta');
    await choose(page, 0, 'Nivel', 'Avanzado');
    await page.getByRole('checkbox', { name: 'Domingo' }).check();
    await page.getByRole('checkbox', { name: 'Tarde' }).check();

    // Se fuerza en el cuerpo una frecuencia que la interfaz no permite enviar (8),
    // para obtener la regla autoritativa del backend en `sports[0].frequency_per_week`.
    await page.route(`**${SPORT_HABITS_PATH}`, async (route) => {
      const body = route.request().postDataJSON() as {
        sports: { frequency_per_week: number }[];
      };
      body.sports[0].frequency_per_week = 8;
      await route.continue({ postData: JSON.stringify(body) });
    });
    expect(await save(page)).toBe(422);

    await expect(page.getByTestId('sport-habits-errors')).toContainText(
      'Deporte 1 (veces por semana)',
    );
    await expect(page.getByTestId('sport-habits-saved')).toHaveCount(0);
    await page.unroute(`**${SPORT_HABITS_PATH}`);
    await page.reload();
    await expect(page.getByTestId('sport-habits-empty')).toBeVisible();
  });
});
