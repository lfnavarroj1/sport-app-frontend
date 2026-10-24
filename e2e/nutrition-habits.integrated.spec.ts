import { Page, expect, test } from '@playwright/test';

/**
 * HU009 de punta a punta: Angular → BFF web → users-management (comando) y
 * `usuarios-read-projector` (lectura del perfil), contra el ambiente de
 * `PLAYWRIGHT_BASE_URL`. Requiere `bff-web` 0.21.0 o superior,
 * `users-management` 0.10.0 con las migraciones `0006_nutrition_habits` (escritura)
 * y `0005_nutrition_habits_view` (lectura), el proyector que aplica
 * `habitos.alimenticios_actualizados.v1` y `HEALTH_DATA_CONSENT_VERSION` igual a
 * `healthDataConsentVersion` del `app-config.json` del ambiente. Registra un
 * deportista sintético con un correo único por ejecución.
 */

const PASSWORD = 'clave-sintetica-e2e-123';
const NUTRITION_HABITS_PATH = '/v1/me/nutrition-habits';
/** La lectura del perfil es una proyección: se espera a que alcance al comando. */
const PROJECTION = { timeout: 30_000, intervals: [1_000, 2_000, 5_000] };

function uniqueEmail(): string {
  return `e2e-hu009-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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
const form = (page: Page) => page.getByTestId('nutrition-habits-form');

async function choose(page: Page, label: string, option: string): Promise<void> {
  await form(page)
    .locator('mat-form-field', { has: page.getByLabel(label, { exact: true }) })
    .click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

async function acceptConsent(page: Page): Promise<void> {
  await form(page)
    .getByRole('checkbox', { name: /Acepto que SportApp trate mis datos de salud/ })
    .check();
}

/** Guarda los hábitos y devuelve el estado HTTP del `PUT`. */
async function save(page: Page): Promise<number> {
  const response = page.waitForResponse(
    (r) => new URL(r.url()).pathname === NUTRITION_HABITS_PATH && r.request().method() === 'PUT',
  );
  await button(page, 'Guardar hábitos alimenticios').click();
  return (await response).status();
}

/** Recarga hasta que la proyección muestre el texto en el elemento indicado. */
async function expectProjected(page: Page, testId: string, text: string): Promise<void> {
  await expect(async () => {
    await page.reload();
    await expect(page.getByTestId(testId)).toContainText(text, { timeout: 2_000 });
  }).toPass(PROJECTION);
}

test.describe('HU009 Hábitos alimenticios contra el BFF web @integrado', () => {
  test('CA1 y CA6: registra con consentimiento, los ve tras recargar y un reemplazo viejo no sobrescribe', async ({
    page,
  }) => {
    await registerAndLogin(page);
    await page.locator('mat-sidenav [data-menu-item="profile"]').click();
    await expect(page).toHaveURL(/\/deportista\/perfil$/);
    await expect(page.getByTestId('nutrition-habits-empty')).toBeVisible();

    // CA1: 201 con el estado normalizado (listas en el orden del catálogo).
    await button(page, 'Registrar hábitos alimenticios').click();
    await choose(page, 'Patrón alimentario', 'Vegetariano');
    await choose(page, 'Comidas por día', '4');
    await form(page).getByLabel('Hidratación diaria (opcional)').fill('2,5');
    await form(page).getByRole('checkbox', { name: 'Bajo en azúcar' }).check();
    await form(page).getByRole('checkbox', { name: 'Sin lactosa' }).check();
    await form(page).getByRole('checkbox', { name: 'Mariscos' }).check();
    await form(page).getByRole('checkbox', { name: 'Maní' }).check();
    await expect(button(page, 'Guardar hábitos alimenticios')).toBeDisabled();
    await acceptConsent(page);
    expect(await save(page)).toBe(201);
    await expect(page.getByTestId('nutrition-habits-saved')).toHaveText(
      'Registramos tus hábitos alimenticios.',
    );
    await expect(page.getByTestId('nutrition-habits-restrictions')).toHaveText(
      /Sin lactosa\s*Bajo en azúcar/,
    );

    // Tras recargar, los hábitos llegan de la proyección (`GET /v1/me/profile`).
    await expectProjected(page, 'nutrition-habits-allergies', 'Mariscos');
    await expect(page.getByTestId('nutrition-habits-hydration')).toHaveText('2,5 L por día');

    // CA6: la segunda pestaña carga la versión 1 antes del reemplazo de la primera.
    const other = await page.context().newPage();
    await other.goto('/deportista/perfil');
    await expect(other.getByTestId('nutrition-habits-pattern')).toHaveText('Vegetariano');

    await button(page, 'Editar hábitos alimenticios').click();
    await choose(page, 'Patrón alimentario', 'Vegano');
    await acceptConsent(page);
    expect(await save(page)).toBe(200);
    await expect(page.getByTestId('nutrition-habits-saved')).toHaveText(
      'Actualizamos tus hábitos alimenticios.',
    );

    await button(other, 'Editar hábitos alimenticios').click();
    await choose(other, 'Comidas por día', '6');
    await acceptConsent(other);
    expect(await save(other)).toBe(409);
    await expect(other.getByTestId('nutrition-habits-conflict')).toContainText(
      'no se sobrescribieron',
    );
    // El valor vigente es el de la primera pestaña, no el del reemplazo rechazado.
    await expectProjected(other, 'nutrition-habits-pattern', 'Vegano');
    await expect(other.getByTestId('nutrition-habits-meals')).toHaveText('4');
  });

  test('CA2: un 422 del backend se marca en su campo y no guarda nada', async ({ page }) => {
    await registerAndLogin(page);
    await page.goto('/deportista/perfil');
    await button(page, 'Registrar hábitos alimenticios').click();
    await choose(page, 'Patrón alimentario', 'Omnívoro');
    await choose(page, 'Comidas por día', '3');
    await form(page).getByRole('checkbox', { name: 'Huevo' }).check();
    await acceptConsent(page);

    // Se fuerza en el cuerpo una alergia repetida que la interfaz no permite enviar,
    // para obtener la regla autoritativa del backend en `allergies[1]`.
    await page.route(`**${NUTRITION_HABITS_PATH}`, async (route) => {
      const body = route.request().postDataJSON() as { allergies: string[] };
      body.allergies = ['EGGS', 'EGGS'];
      await route.continue({ postData: JSON.stringify(body) });
    });
    expect(await save(page)).toBe(422);

    await expect(page.getByTestId('nutrition-habits-errors')).toContainText(
      'Alergias alimentarias',
    );
    await expect(page.getByTestId('nutrition-habits-saved')).toHaveCount(0);
    await page.unroute(`**${NUTRITION_HABITS_PATH}`);
    await page.reload();
    await expect(page.getByTestId('nutrition-habits-empty')).toBeVisible();
  });
});
