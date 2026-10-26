import {
  APIRequestContext,
  APIResponse,
  Browser,
  Locator,
  Page,
  Response,
  expect,
  request,
  test,
} from '@playwright/test';

/**
 * HU030 (web del profesional) de punta a punta: Angular → BFF web →
 * training-management, contra el ambiente de `PLAYWRIGHT_BASE_URL`. Requiere
 * `bff-web` 0.34.0 y el `training-management` que publica las rutinas de
 * alimentación (ADR-041) desplegados, con el catálogo de alimentos de HU014; el
 * permiso `nutrition.plan.author` del profesional ya existe en
 * `actor-permissions`. Las cuentas son sintéticas, con correos únicos por ejecución.
 */

const PASSWORD = 'clave-sintetica-e2e-123';
const ROUTINES = /^\/v1\/nutrition-routine-templates$/;
const RETIRE = /^\/v1\/nutrition-routine-templates\/[^/]+\/retire$/;

function baseUrl(): string {
  const url = process.env['PLAYWRIGHT_BASE_URL'];
  if (!url) {
    throw new Error('PLAYWRIGHT_BASE_URL es obligatoria para la suite integrada.');
  }
  return url.replace(/\/$/, '');
}

function uniqueEmail(role: string): string {
  return `e2e-hu030-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

/** Comprueba el estado HTTP; si no coincide, deja operación, estado, `code` y `correlation_id`. */
async function expectStatus(
  response: Response | APIResponse,
  expected: number,
  operation: string,
): Promise<void> {
  if (response.status() === expected) {
    return;
  }
  let body: { code?: string; correlation_id?: string } = {};
  try {
    body = (await response.json()) as typeof body;
  } catch {
    // Sin cuerpo JSON.
  }
  expect(
    response.status(),
    `${operation} → ${response.status()} code=${body.code ?? '-'} correlation_id=${body.correlation_id ?? '-'}`,
  ).toBe(expected);
}

function waitFor(page: Page, path: RegExp): Promise<Response> {
  return page.waitForResponse(
    (r) => r.request().method() === 'POST' && path.test(new URL(r.url()).pathname),
  );
}

async function newPage(browser: Browser): Promise<Page> {
  return (await browser.newContext()).newPage();
}

async function registerAndLogin(page: Page, email: string): Promise<void> {
  await page.goto('/registro');
  await page.getByLabel('Nombre completo').fill('Profesional Sintética E2E');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Tipo de usuario').click();
  await page.getByRole('option', { name: 'Profesional de servicios' }).click();
  await page.getByLabel(/Acepto las políticas/).check();
  await page.getByRole('button', { name: 'Registrarme' }).click();
  await expect(page.getByRole('status')).toContainText(email);

  await page.goto('/iniciar-sesion');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).toHaveURL(/\/profesional\/inicio$/);
}

/** Sesión propia de la API de `bff-web` (contexto aparte: no comparte la cookie). */
async function apiSession(email: string): Promise<{ api: APIRequestContext; token: string }> {
  const config = (await (await fetch(`${baseUrl()}/app-config.json`)).json()) as {
    bffWebBaseUrl: string;
  };
  const api = await request.newContext({
    baseURL: config.bffWebBaseUrl,
    extraHTTPHeaders: { Origin: baseUrl() },
  });
  const session = await api.post('/v1/sessions', { data: { email, password: PASSWORD } });
  await expectStatus(session, 200, 'API POST /v1/sessions');
  return { api, token: ((await session.json()) as { access_token: string }).access_token };
}

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const form = (page: Page) => page.getByTestId('routine-form');
const meal = (page: Page, index: number) => form(page).locator(`[data-meal="${index}"]`);

async function choose(scope: Locator, label: string, option: string): Promise<void> {
  await scope
    .locator('mat-form-field', { has: scope.page().getByLabel(label, { exact: true }) })
    .click();
  await scope.page().getByRole('option', { name: option, exact: true }).click();
}

async function fillItem(page: Page, m: number, i: number, food: string, portions: number) {
  const target = meal(page, m).locator(`[data-item="${i}"]`);
  await choose(target, `Alimento ${i + 1}`, food);
  await target.getByLabel(`Porciones del alimento ${i + 1}`).fill(String(portions));
}

test.describe('HU030 Rutinas de alimentación del profesional contra el BFF web @integrado', () => {
  test('CA2 y CA4: publica una rutina real con alérgenos, la retira y otro profesional no puede retirarla', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const suffix = Math.random().toString(36).slice(2, 8);
    const title = `Rutina integrada ${suffix}`;
    const email = uniqueEmail('profesional');
    const page = await newPage(browser);
    await registerAndLogin(page, email);
    const menuItem = page.locator('mat-sidenav [data-menu-item="nutrition-routines"]');
    await expect(
      menuItem,
      'el BFF desplegado debe conceder nutrition.plan.author al profesional',
    ).toBeVisible({ timeout: 15_000 });
    await menuItem.click();
    await expect(page).toHaveURL(/\/profesional\/alimentacion\/plantillas$/);

    await button(page, 'Publicar una rutina').click();
    await form(page).getByLabel('Título', { exact: true }).fill(title);
    await form(page)
      .getByLabel('Descripción', { exact: true })
      .fill('Rutina sintética de la prueba integrada de HU030.');
    await choose(form(page), 'Objetivo', 'Salud');
    await choose(form(page), 'Patrón alimentario', 'Vegetariano');
    await form(page).getByLabel('Vigencia (días)', { exact: true }).fill('7');
    await page.getByTestId('routine-allergens').getByText('Leche', { exact: true }).click();
    await choose(meal(page, 0), 'Tipo de comida', 'Desayuno');
    await fillItem(page, 0, 0, 'Avena', 2);
    await page.getByTestId('routine-add-item-0').click();
    // CA4: una regla real del servicio: la pechuga de pollo no es vegetariana.
    await fillItem(page, 0, 1, 'Pechuga de pollo', 1);
    const rejected = waitFor(page, ROUTINES);
    await button(page, 'Publicar rutina').click();
    await expectStatus(await rejected, 422, 'POST /v1/nutrition-routine-templates (incompatible)');
    await expect(page.getByTestId('routine-errors')).toContainText(
      'Comida 1, alimento 2: El alimento no es compatible con el patrón alimentario',
    );

    // CA2 y CA4: publicación real; el servicio agrega el maní de la mantequilla.
    await fillItem(page, 0, 1, 'Mantequilla de maní', 1);
    const published = waitFor(page, ROUTINES);
    await button(page, 'Publicar rutina').click();
    const response = await published;
    await expectStatus(response, 201, 'POST /v1/nutrition-routine-templates');
    const routine = (await response.json()) as {
      template_id: string;
      status: string;
      version: number;
      contains_allergens: string[];
      daily_meals: unknown[];
    };
    expect(routine.status).toBe('PUBLISHED');
    expect(routine.version).toBe(1);
    expect(routine.contains_allergens).toEqual(['PEANUTS', 'MILK']);
    expect(routine.daily_meals).toHaveLength(1);
    await expect(page.getByTestId('routine-published')).toContainText(title);
    const item = page.locator(`li[data-routine="${routine.template_id}"]`);
    await expect(item.getByTestId('routine-allergens-list')).toHaveText('Maní, Leche');
    await expect(item.getByTestId('routine-days')).toHaveText('7 días');
    await expect(item.getByTestId('routine-meals-list')).toContainText(
      'Desayuno: Avena ×2, Mantequilla de maní ×1',
    );

    // La lista la entrega el BFF tras recargar.
    await page.reload();
    await expect(item.getByTestId('routine-status')).toHaveText('Publicada');

    // Otro profesional no puede retirarla.
    const outsiderEmail = uniqueEmail('otro-profesional');
    await registerAndLogin(await newPage(browser), outsiderEmail);
    const outsider = await apiSession(outsiderEmail);
    const foreign = await outsider.api.post(
      `/v1/nutrition-routine-templates/${routine.template_id}/retire`,
      {
        headers: { Authorization: `Bearer ${outsider.token}` },
        data: { expected_version: 1 },
      },
    );
    await expectStatus(foreign, 404, 'POST /v1/nutrition-routine-templates/{id}/retire (ajena)');
    expect(((await foreign.json()) as { code: string }).code).toBe('template_not_found');
    await outsider.api.dispose();

    // CA4: el autor la retira tras confirmar; se conserva como retirada.
    await item.getByRole('button', { name: /^Retirar la rutina/ }).click();
    const retired = waitFor(page, RETIRE);
    await item.getByRole('button', { name: 'Sí, retirar' }).click();
    const retiredResponse = await retired;
    await expectStatus(retiredResponse, 200, 'POST /v1/nutrition-routine-templates/{id}/retire');
    const retiredRoutine = (await retiredResponse.json()) as { status: string; version: number };
    expect(retiredRoutine.status).toBe('RETIRED');
    await expect(item.getByTestId('routine-status')).toHaveText('Retirada');
    await page.reload();
    await expect(item.getByTestId('routine-status')).toHaveText('Retirada');
    await expect(item.getByRole('button', { name: /Retirar/ })).toHaveCount(0);

    // CA4: retirar otra vez una rutina ya retirada la devuelve sin cambios.
    const author = await apiSession(email);
    const again = await author.api.post(
      `/v1/nutrition-routine-templates/${routine.template_id}/retire`,
      {
        headers: { Authorization: `Bearer ${author.token}` },
        data: { expected_version: retiredRoutine.version },
      },
    );
    await expectStatus(
      again,
      200,
      'POST /v1/nutrition-routine-templates/{id}/retire (ya retirada)',
    );
    expect(await again.json()).toMatchObject({
      status: 'RETIRED',
      version: retiredRoutine.version,
    });
    await author.api.dispose();
  });
});
