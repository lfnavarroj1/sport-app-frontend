import { Page, expect, test } from '@playwright/test';

/**
 * HU002 de punta a punta: Angular → BFF web → users-management (comando) y
 * `usuarios-read-projector` (`user_directory`, lectura de la cuenta), contra el
 * ambiente de `PLAYWRIGHT_BASE_URL`. Requiere `bff-web` 0.28.0 o superior y
 * `users-management` 0.13.0 con el proyector que aplica `usuario.actualizado.v1`.
 * Registra cuentas sintéticas con un correo único por ejecución.
 */

const PASSWORD = 'clave-sintetica-e2e-123';
/** La lectura de la cuenta es una proyección: se espera a que alcance al comando. */
const PROJECTION = { timeout: 30_000, intervals: [1_000, 2_000, 5_000] };

const ACTORS = [
  { actorType: 'athlete', option: 'Deportista', area: 'deportista' },
  { actorType: 'organizer', option: 'Organizador de eventos', area: 'organizador' },
  { actorType: 'service_provider', option: 'Profesional de servicios', area: 'profesional' },
] as const;

type Actor = (typeof ACTORS)[number];

function uniqueEmail(label: string): string {
  return `e2e-hu002-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function register(page: Page, actor: Actor, email: string): Promise<void> {
  await page.goto('/registro');
  await page.getByLabel('Nombre completo').fill('Persona Sintética E2E');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Tipo de usuario').click();
  await page.getByRole('option', { name: actor.option }).click();
  await page.getByLabel(/Acepto las políticas/).check();
  await page.getByRole('button', { name: 'Registrarme' }).click();
  await expect(page.getByRole('status')).toContainText(email);
}

async function login(page: Page, actor: Actor, email: string): Promise<void> {
  await page.goto('/iniciar-sesion');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).toHaveURL(new RegExp(`/${actor.area}/inicio$`));
}

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

/** Abre «Mi perfil» y espera a que la cuenta esté proyectada (recién registrada, puede tardar). */
async function openProfile(page: Page, actor: Actor): Promise<void> {
  await page.locator('mat-sidenav [data-menu-item="profile"]').click();
  await expect(page).toHaveURL(new RegExp(`/${actor.area}/perfil$`));
  await expect(async () => {
    await page.reload();
    await expect(page.getByTestId('account-summary')).toBeVisible({ timeout: 2_000 });
  }).toPass(PROJECTION);
}

/** Edita nombre y correo y devuelve el estado HTTP del `PUT`. */
async function save(page: Page, fullName: string, email: string): Promise<number> {
  await button(page, 'Editar datos personales').click();
  await page.getByLabel('Nombre completo').fill(fullName);
  await page.getByLabel('Correo electrónico').fill(email);
  const response = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/v1/me/account' && r.request().method() === 'PUT',
  );
  await button(page, 'Guardar datos personales').click();
  return (await response).status();
}

/** Recarga hasta que la proyección muestre el texto indicado. */
async function expectProjected(page: Page, testId: string, text: string): Promise<void> {
  await expect(async () => {
    await page.reload();
    await expect(page.getByTestId(testId)).toHaveText(text, { timeout: 2_000 });
  }).toPass(PROJECTION);
}

test.describe('HU002 Datos personales contra el BFF web @integrado', () => {
  for (const actor of ACTORS) {
    test(`CA1 y CA6 (${actor.actorType}): edita nombre y correo, recarga e inicia sesión con el correo nuevo`, async ({
      page,
    }) => {
      const email = uniqueEmail(actor.actorType);
      const newEmail = uniqueEmail(`${actor.actorType}-nuevo`);
      await register(page, actor, email);
      await login(page, actor, email);
      await openProfile(page, actor);
      await expect(page.getByTestId('account-email')).toHaveText(email);

      // CA1: 200 con la cuenta confirmada; el correo se normaliza a minúsculas.
      expect(await save(page, 'Persona Renombrada E2E', newEmail.toUpperCase())).toBe(200);
      await expect(page.getByTestId('account-saved')).toHaveText('Guardamos tus datos personales.');
      await expect(page.getByTestId('account-email')).toHaveText(newEmail);
      // CA6: la sesión sigue y la cabecera muestra el nombre nuevo.
      await expect(page.getByTestId('session-user')).toHaveText('Persona Renombrada E2E');

      // Tras recargar, la cuenta llega del directorio proyectado y la sesión se renueva.
      await expectProjected(page, 'account-email', newEmail);
      await expect(page.getByTestId('account-full-name')).toHaveText('Persona Renombrada E2E');
      await expect(page.getByTestId('session-user')).toHaveText('Persona Renombrada E2E');

      // CA6: el siguiente inicio de sesión usa el correo nuevo.
      await page.locator('mat-sidenav [data-menu-item="logout"]').click();
      await expect(page).toHaveURL(/\/iniciar-sesion/);
      await login(page, actor, newEmail);
    });
  }

  test('CA3 y CA4: un correo ajeno se rechaza sin detalle y una versión vieja no sobrescribe', async ({
    page,
  }) => {
    const [athlete, organizer] = ACTORS;
    const takenEmail = uniqueEmail('ocupado');
    await register(page, organizer, takenEmail);
    const email = uniqueEmail('titular');
    await register(page, athlete, email);
    await login(page, athlete, email);
    await openProfile(page, athlete);

    // CA3: el correo de otra cuenta → 409 sin revelar nada; se conserva el anterior.
    expect(await save(page, 'Persona Sintética E2E', takenEmail)).toBe(409);
    await expect(page.getByTestId('account-form')).toContainText(
      'No puedes usar este correo. Ingresa otro.',
    );
    await button(page, 'Cancelar').click();
    await expect(page.getByTestId('account-email')).toHaveText(email);

    // CA4: la segunda pestaña cargó la versión anterior al cambio de la primera.
    const other = await page.context().newPage();
    await other.goto(`/${athlete.area}/perfil`);
    await expect(other.getByTestId('account-email')).toHaveText(email);

    expect(await save(page, 'Persona Primera E2E', email)).toBe(200);
    expect(await save(other, 'Persona Segunda E2E', email)).toBe(409);
    await expect(other.getByTestId('account-conflict')).toContainText('No sobrescribimos nada');
    await expectProjected(other, 'account-full-name', 'Persona Primera E2E');
  });
});
