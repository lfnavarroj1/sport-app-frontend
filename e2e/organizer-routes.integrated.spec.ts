import {
  APIRequestContext,
  APIResponse,
  Browser,
  Page,
  Response,
  expect,
  request,
  test,
} from '@playwright/test';

/**
 * HU026 (web del organizador) de punta a punta: Angular → BFF web →
 * training-management, contra el ambiente de `PLAYWRIGHT_BASE_URL`. Requiere
 * `bff-web` 0.23.0 y `training-management` 0.11.0 (migraciones `0007_routes` y
 * `0009_route_view`) desplegados, con `actor-permissions` v2 (ningún ambiente
 * debe fijar `ACTOR_PERMISSIONS_PATH` en la v1). Las cuentas son sintéticas, con
 * correos únicos por ejecución.
 */

const PASSWORD = 'clave-sintetica-e2e-123';
const ROUTES = /^\/v1\/routes$/;
const RETIRE = /^\/v1\/routes\/[^/]+\/retire$/;
const MY_ROUTES = /^\/v1\/me\/routes$/;

function baseUrl(): string {
  const url = process.env['PLAYWRIGHT_BASE_URL'];
  if (!url) {
    throw new Error('PLAYWRIGHT_BASE_URL es obligatoria para la suite integrada.');
  }
  return url.replace(/\/$/, '');
}

function uniqueEmail(role: string): string {
  return `e2e-hu026-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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

/**
 * Recarga y devuelve la primera respuesta de la operación que emite el documento
 * nuevo, con su cuerpo ya leído. Esperarla desde antes de recargar podría capturar
 * una respuesta del documento anterior. Cada llamada termina antes de la siguiente
 * recarga, así que tampoco aborta una renovación de sesión en curso (perdería la
 * cookie rotada).
 */
async function reloadFor<T>(
  page: Page,
  method: string,
  path: RegExp,
): Promise<{ response: Response; body: T | null }> {
  await page.reload({ waitUntil: 'commit' });
  const response = await page.waitForResponse(
    (r) => r.request().method() === method && path.test(new URL(r.url()).pathname),
  );
  try {
    return { response, body: (await response.json()) as T };
  } catch {
    return { response, body: null };
  }
}

/**
 * La lista del organizador sale de la proyección, que es eventual: recarga hasta que
 * `GET /v1/me/routes` entregue la ruta con `status`.
 */
async function waitForProjectedRoute(
  page: Page,
  routeId: string,
  status: 'PUBLISHED' | 'RETIRED',
): Promise<void> {
  await expect(async () => {
    const { response, body } = await reloadFor<{
      items: { route_id: string; status: string }[];
    }>(page, 'GET', MY_ROUTES);
    await expectStatus(response, 200, 'GET /v1/me/routes');
    expect(body?.items.find((r) => r.route_id === routeId)?.status).toBe(status);
  }, `la ruta debía quedar proyectada como ${status}`).toPass({ timeout: 60_000 });
}

async function newPage(browser: Browser): Promise<Page> {
  return (await browser.newContext()).newPage();
}

async function registerAndLogin(page: Page, email: string): Promise<void> {
  await page.goto('/registro');
  await page.getByLabel('Nombre completo').fill('Organizadora Sintética E2E');
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
const form = (page: Page) => page.getByTestId('route-form');

async function choose(page: Page, label: string, option: string): Promise<void> {
  await form(page)
    .locator('mat-form-field', { has: page.getByLabel(label, { exact: true }) })
    .click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

test.describe('HU026 Rutas del organizador contra el BFF web @integrado', () => {
  test('CA1, CA2 y CA4: publica una ruta real, la retira y otro organizador no puede retirarla', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const suffix = Math.random().toString(36).slice(2, 8);
    const routeName = `Ruta integrada ${suffix}`;
    const page = await newPage(browser);
    await registerAndLogin(page, uniqueEmail('organizador'));
    const menuItem = page.locator('mat-sidenav [data-menu-item="organizer-routes"]');
    await expect(
      menuItem,
      'el BFF desplegado debe conceder training.routes.author (actor-permissions v2, bff-web 0.23.0)',
    ).toBeVisible({ timeout: 15_000 });
    await menuItem.click();
    await expect(page).toHaveURL(/\/organizador\/rutas$/);

    // CA2: una regla real del servicio (nombre demasiado corto tras forzar el cuerpo).
    await button(page, 'Publicar una ruta').click();
    await form(page).getByLabel('Nombre', { exact: true }).fill(routeName);
    await choose(page, 'Deporte', 'Ciclismo');
    await form(page).getByLabel('Distancia (km)').fill('42,3');
    await choose(page, 'Dificultad', 'Alta');
    await form(page).getByLabel('Ciudad').fill('Medellín');
    await form(page).getByLabel('País (código ISO de 2 letras)').fill('CO');
    await form(page).getByLabel('Latitud de inicio').fill('6.2442');
    await form(page).getByLabel('Longitud de inicio').fill('-75.5812');
    await page.route('**/v1/routes', async (route) => {
      const body = route.request().postDataJSON() as { name: string };
      await route.continue({ postData: JSON.stringify({ ...body, name: 'ab' }) });
    });
    const rejected = waitFor(page, ROUTES);
    await button(page, 'Publicar ruta').click();
    await expectStatus(await rejected, 422, 'POST /v1/routes (nombre corto)');
    await expect(page.getByTestId('route-errors')).toContainText('Nombre');
    await page.unroute('**/v1/routes');

    // CA1: publicación real, idempotente con la clave del intento.
    await form(page).getByLabel('Nombre', { exact: true }).fill(routeName);
    const published = waitFor(page, ROUTES);
    await button(page, 'Publicar ruta').click();
    const response = await published;
    await expectStatus(response, 201, 'POST /v1/routes');
    const route = (await response.json()) as { route_id: string; status: string; version: number };
    expect(route.status).toBe('PUBLISHED');
    expect(route.version).toBe(1);
    await expect(page.getByTestId('route-published')).toContainText(routeName);
    const item = page.locator(`li[data-route="${route.route_id}"]`);
    await expect(item).toContainText('42,3 km');

    // La lista la entrega el BFF tras recargar, cuando la proyección la incluye.
    await waitForProjectedRoute(page, route.route_id, 'PUBLISHED');
    await expect(item).toContainText('Publicada');

    // CA4: otro organizador no puede retirarla.
    const outsiderEmail = uniqueEmail('otro-organizador');
    await registerAndLogin(await newPage(browser), outsiderEmail);
    const outsider = await apiSession(outsiderEmail);
    const foreign = await outsider.api.post(`/v1/routes/${route.route_id}/retire`, {
      headers: { Authorization: `Bearer ${outsider.token}` },
      data: { expected_version: 1 },
    });
    await expectStatus(foreign, 404, 'POST /v1/routes/{id}/retire (ajena)');
    await outsider.api.dispose();

    // CA4: el autor la retira tras confirmar; se conserva como retirada.
    await item.getByRole('button', { name: /^Retirar la ruta/ }).click();
    const retired = waitFor(page, RETIRE);
    await item.getByRole('button', { name: 'Sí, retirar' }).click();
    await expectStatus(await retired, 200, 'POST /v1/routes/{id}/retire');
    await expect(item).toContainText('Retirada');
    await waitForProjectedRoute(page, route.route_id, 'RETIRED');
    await expect(item).toContainText('Retirada');
  });
});
