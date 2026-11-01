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
 * HU028 (web del profesional) de punta a punta: Angular → BFF web →
 * training-management, contra el ambiente de `PLAYWRIGHT_BASE_URL`. Requiere
 * `bff-web` 0.24.0 y el `training-management` que publica las plantillas de plan
 * (ADR-041) desplegados; el permiso `training.plan.author` del profesional ya
 * existe en `actor-permissions`. Las cuentas son sintéticas, con correos únicos
 * por ejecución.
 */

const PASSWORD = 'clave-sintetica-e2e-123';
const TEMPLATES = /^\/v1\/training-plan-templates$/;
const RETIRE = /^\/v1\/training-plan-templates\/[^/]+\/retire$/;
const MY_TEMPLATES = /^\/v1\/me\/training-plan-templates$/;

function baseUrl(): string {
  const url = process.env['PLAYWRIGHT_BASE_URL'];
  if (!url) {
    throw new Error('PLAYWRIGHT_BASE_URL es obligatoria para la suite integrada.');
  }
  return url.replace(/\/$/, '');
}

function uniqueEmail(role: string): string {
  return `e2e-hu028-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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
 * La lista del profesional sale de la proyección, que es eventual: recarga hasta que
 * `GET /v1/me/training-plan-templates` entregue la plantilla con `status`.
 */
async function waitForProjectedTemplate(
  page: Page,
  templateId: string,
  status: 'PUBLISHED' | 'RETIRED',
): Promise<void> {
  await expect(async () => {
    const { response, body } = await reloadFor<{
      items: { template_id: string; status: string }[];
    }>(page, 'GET', MY_TEMPLATES);
    await expectStatus(response, 200, 'GET /v1/me/training-plan-templates');
    expect(body?.items.find((t) => t.template_id === templateId)?.status).toBe(status);
  }, `la plantilla debía quedar proyectada como ${status}`).toPass({ timeout: 60_000 });
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
const form = (page: Page) => page.getByTestId('template-form');

async function choose(page: Page, label: string, option: string): Promise<void> {
  await form(page)
    .locator('mat-form-field', { has: page.getByLabel(label, { exact: true }) })
    .click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

test.describe('HU028 Plantillas de entrenamiento del profesional contra el BFF web @integrado', () => {
  test('CA3 y CA4: publica una plantilla real, la retira y otro profesional no puede retirarla', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const suffix = Math.random().toString(36).slice(2, 8);
    const title = `Plantilla integrada ${suffix}`;
    const email = uniqueEmail('profesional');
    const page = await newPage(browser);
    await registerAndLogin(page, email);
    const menuItem = page.locator('mat-sidenav [data-menu-item="training-templates"]');
    await expect(
      menuItem,
      'el BFF desplegado debe conceder training.plan.author al profesional',
    ).toBeVisible({ timeout: 15_000 });
    await menuItem.click();
    await expect(page).toHaveURL(/\/profesional\/entrenamientos\/plantillas$/);

    // CA4: una regla real del servicio (título demasiado corto tras forzar el cuerpo).
    await button(page, 'Publicar una plantilla').click();
    await form(page).getByLabel('Título', { exact: true }).fill(title);
    await form(page)
      .getByLabel('Objetivos', { exact: true })
      .fill('Plantilla sintética de la prueba integrada de HU028 para ciclismo de base.');
    await choose(page, 'Deporte', 'Ciclismo');
    await choose(page, 'Objetivo principal', 'Salud');
    await choose(page, 'Nivel', 'Intermedio');
    await form(page).getByLabel('Duración (semanas)', { exact: true }).fill('6');
    await choose(page, 'Día de la sesión 1', 'Martes');
    await form(page).getByLabel('Duración de la sesión 1 (minutos)').fill('60');
    await form(page).getByLabel('Descripción de la sesión 1').fill('Rodaje continuo en zona 2.');
    await button(page, 'Agregar sesión').click();
    await choose(page, 'Día de la sesión 2', 'Domingo');
    await form(page).getByLabel('Duración de la sesión 2 (minutos)').fill('120');
    await form(page).getByLabel('Descripción de la sesión 2').fill('Fondo largo a ritmo cómodo.');
    await page.route('**/v1/training-plan-templates', async (route) => {
      const body = route.request().postDataJSON() as { title: string };
      await route.continue({ postData: JSON.stringify({ ...body, title: 'ab' }) });
    });
    const rejected = waitFor(page, TEMPLATES);
    await button(page, 'Publicar plantilla').click();
    await expectStatus(await rejected, 422, 'POST /v1/training-plan-templates (título corto)');
    await expect(page.getByTestId('template-errors')).toContainText('Título');
    await page.unroute('**/v1/training-plan-templates');

    // CA4: publicación real, idempotente con la clave del intento.
    await form(page).getByLabel('Título', { exact: true }).fill(title);
    const published = waitFor(page, TEMPLATES);
    await button(page, 'Publicar plantilla').click();
    const response = await published;
    await expectStatus(response, 201, 'POST /v1/training-plan-templates');
    const template = (await response.json()) as {
      template_id: string;
      status: string;
      version: number;
      weekly_sessions: unknown[];
    };
    expect(template.status).toBe('PUBLISHED');
    expect(template.version).toBe(1);
    expect(template.weekly_sessions).toHaveLength(2);
    await expect(page.getByTestId('template-published')).toContainText(title);
    const item = page.locator(`li[data-template="${template.template_id}"]`);
    await expect(item.getByTestId('template-weeks')).toHaveText('6');
    await expect(item.getByTestId('template-sessions-list')).toContainText(
      '2 por semana · 180 min en total',
    );

    // La lista la entrega el BFF tras recargar, cuando la proyección la incluye.
    await waitForProjectedTemplate(page, template.template_id, 'PUBLISHED');
    await expect(item.getByTestId('template-status')).toHaveText('Publicada');

    // CA3: otro profesional no puede retirarla.
    const outsiderEmail = uniqueEmail('otro-profesional');
    await registerAndLogin(await newPage(browser), outsiderEmail);
    const outsider = await apiSession(outsiderEmail);
    const foreign = await outsider.api.post(
      `/v1/training-plan-templates/${template.template_id}/retire`,
      {
        headers: { Authorization: `Bearer ${outsider.token}` },
        data: { expected_version: 1 },
      },
    );
    await expectStatus(foreign, 404, 'POST /v1/training-plan-templates/{id}/retire (ajena)');
    expect(((await foreign.json()) as { code: string }).code).toBe('template_not_found');
    await outsider.api.dispose();

    // CA3: el autor la retira tras confirmar; se conserva como retirada.
    await item.getByRole('button', { name: /^Retirar la plantilla/ }).click();
    const retired = waitFor(page, RETIRE);
    await item.getByRole('button', { name: 'Sí, retirar' }).click();
    const retiredResponse = await retired;
    await expectStatus(retiredResponse, 200, 'POST /v1/training-plan-templates/{id}/retire');
    const retiredTemplate = (await retiredResponse.json()) as { status: string; version: number };
    expect(retiredTemplate.status).toBe('RETIRED');
    await expect(item.getByTestId('template-status')).toHaveText('Retirada');
    await waitForProjectedTemplate(page, template.template_id, 'RETIRED');
    await expect(item.getByTestId('template-status')).toHaveText('Retirada');
    await expect(item.getByRole('button', { name: /Retirar/ })).toHaveCount(0);

    // Retirar otra vez una plantilla ya retirada la devuelve sin cambios.
    const author = await apiSession(email);
    const again = await author.api.post(
      `/v1/training-plan-templates/${template.template_id}/retire`,
      {
        headers: { Authorization: `Bearer ${author.token}` },
        data: { expected_version: retiredTemplate.version },
      },
    );
    await expectStatus(again, 200, 'POST /v1/training-plan-templates/{id}/retire (ya retirada)');
    expect(await again.json()).toMatchObject({
      status: 'RETIRED',
      version: retiredTemplate.version,
    });
    await author.api.dispose();
  });
});
