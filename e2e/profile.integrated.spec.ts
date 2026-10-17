import { Page, expect, test } from '@playwright/test';

/**
 * HU005 de punta a punta: Angular → BFF web → users-management (comandos) y
 * `usuarios-read-projector` (lectura del perfil), contra el ambiente de
 * `PLAYWRIGHT_BASE_URL`. Requiere `bff-web` 0.13.0 o superior,
 * `users-management` 0.6.0, `usuarios-read-projector` desplegado y
 * `HEALTH_DATA_CONSENT_VERSION=local-dev` en el ConfigMap `sportapp-runtime`
 * (la misma versión para la web y para users-management). Registra un
 * deportista sintético con un correo único por ejecución.
 */

const PASSWORD = 'clave-sintetica-e2e-123';
/** La lectura del perfil es una proyección: se espera a que alcance al comando. */
const PROJECTION = { timeout: 30_000, intervals: [1_000, 2_000, 5_000] };

function uniqueEmail(): string {
  return `e2e-hu005-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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

async function choose(page: Page, label: string, option: string): Promise<void> {
  // Se pulsa el campo completo, como una persona: en una fila estrecha la etiqueta de un
  // `mat-select` vacío cubre el disparador y `mat-form-field` reenvía el clic al control.
  await page.locator('mat-form-field', { has: page.getByLabel(label) }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

/** Guarda con el botón indicado y devuelve el estado HTTP del `PUT`. */
async function save(page: Page, name: string, path: string): Promise<number> {
  const response = page.waitForResponse(
    (r) => new URL(r.url()).pathname === path && r.request().method() === 'PUT',
  );
  await button(page, name).click();
  return (await response).status();
}

/** Recarga hasta que la proyección muestre el texto en el resumen indicado. */
async function expectProjected(page: Page, testId: string, text: string): Promise<void> {
  await expect(async () => {
    await page.reload();
    await expect(page.getByTestId(testId)).toContainText(text, { timeout: 2_000 });
  }).toPass(PROJECTION);
}

test.describe('HU005 Datos demográficos y fisiológicos contra el BFF web @integrado', () => {
  test('CA1 y CA6: registra ambas secciones, las ve tras recargar y un reemplazo viejo no sobrescribe', async ({
    page,
  }) => {
    await registerAndLogin(page);
    await page.locator('mat-sidenav [data-menu-item="profile"]').click();
    await expect(page).toHaveURL(/\/deportista\/perfil$/);
    await expect(page.getByTestId('state-error')).toHaveCount(0);

    // CA1 demográfica: 201 con la representación normalizada.
    await button(page, 'Registrar datos demográficos').click();
    await page.getByLabel('Fecha de nacimiento').fill('1992-04-18');
    await choose(page, 'Género', 'Femenino');
    await page.getByLabel('País de residencia (código)').fill('CO');
    await page.getByLabel('Ciudad de residencia').fill('Bogotá');
    expect(await save(page, 'Guardar datos demográficos', '/v1/me/demographic-profile')).toBe(201);
    await expect(page.getByTestId('demographic-saved')).toHaveText(
      'Registramos tus datos demográficos.',
    );

    // CA1 fisiológica con consentimiento: 201 con el IMC calculado por el backend.
    await button(page, 'Registrar datos fisiológicos').click();
    await page.getByLabel('Peso (kg)').fill('68,5');
    await page.getByLabel('Altura (cm)').fill('172');
    await page.getByLabel(/Acepto que SportApp trate mis datos de salud/).check();
    expect(await save(page, 'Guardar datos fisiológicos', '/v1/me/physiological-profile')).toBe(
      201,
    );
    await expect(page.getByTestId('physiological-saved')).toHaveText(
      'Registramos tus datos fisiológicos.',
    );
    await expect(page.getByTestId('physiological-bmi')).toContainText('23,2');

    // Tras recargar, los valores llegan de la proyección.
    await expectProjected(page, 'demographic-summary', 'Bogotá');
    await expectProjected(page, 'physiological-bmi', '23,2');

    // CA6: la segunda pestaña carga la versión 1 antes del reemplazo de la primera.
    const other = await page.context().newPage();
    await other.goto('/deportista/perfil');
    await expect(other.getByTestId('demographic-summary')).toContainText('Bogotá');

    await button(page, 'Editar datos demográficos').click();
    await page.getByLabel('Ciudad de residencia').fill('Medellín');
    expect(await save(page, 'Guardar datos demográficos', '/v1/me/demographic-profile')).toBe(200);

    await button(other, 'Editar datos demográficos').click();
    await other.getByLabel('Ciudad de residencia').fill('Cali');
    expect(await save(other, 'Guardar datos demográficos', '/v1/me/demographic-profile')).toBe(409);
    await expect(other.getByTestId('demographic-conflict')).toContainText(
      'cambiaron en otra sesión y no se sobrescribieron',
    );
    // El valor vigente es el de la primera pestaña, no el del reemplazo rechazado.
    await expectProjected(other, 'demographic-summary', 'Medellín');
  });
});
