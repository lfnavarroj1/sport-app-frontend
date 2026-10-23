import { randomUUID } from 'node:crypto';

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
 * HU019 de punta a punta: Angular → BFF web → complementary-services (base única
 * con outbox, sin proyección), contra el ambiente de `PLAYWRIGHT_BASE_URL`.
 * Requiere `bff-web` 0.11.0 o superior. Los borradores se crean por API con
 * `POST /v1/services` de `bff-web` (HU015); la web revisa y publica. Las cuentas
 * son sintéticas, con correos únicos por ejecución.
 */

const PASSWORD = 'clave-sintetica-e2e-123';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DAY_MS = 86_400_000;

interface ApiSession {
  readonly api: APIRequestContext;
  readonly token: string;
}

function baseUrl(): string {
  const url = process.env['PLAYWRIGHT_BASE_URL'];
  if (!url) {
    throw new Error('PLAYWRIGHT_BASE_URL es obligatoria para la suite integrada.');
  }
  return url.replace(/\/$/, '');
}

function uniqueEmail(role: string): string {
  return `e2e-hu019-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function errorOf(
  response: Response | APIResponse,
): Promise<{ code?: string; correlation_id?: string }> {
  try {
    return (await response.json()) as { code?: string; correlation_id?: string };
  } catch {
    return {};
  }
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
  const body = await errorOf(response);
  expect(
    response.status(),
    `${operation} → ${response.status()} code=${body.code ?? '-'} correlation_id=${body.correlation_id ?? '-'}`,
  ).toBe(expected);
}

function waitForOperation(page: Page, method: string, path: RegExp): Promise<Response> {
  return page.waitForResponse(
    (r) => r.request().method() === method && path.test(new URL(r.url()).pathname),
  );
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
  const created = waitForOperation(page, 'POST', /^\/v1\/users$/);
  await page.getByRole('button', { name: 'Registrarme' }).click();
  await expectStatus(await created, 201, 'POST /v1/users');
  await expect(page.getByRole('status')).toContainText(email);
}

async function login(page: Page, email: string): Promise<void> {
  await page.goto('/iniciar-sesion');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  const session = waitForOperation(page, 'POST', /^\/v1\/sessions$/);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expectStatus(await session, 200, 'POST /v1/sessions');
  // Navegar antes de llegar al inicio perdería la sesión recién creada.
  await expect(page).toHaveURL(/\/profesional\/inicio$/);
}

/**
 * Sesión propia de la API de `bff-web` (contexto aparte: no comparte la cookie
 * de renovación con el navegador). La URL del BFF sale del `app-config.json`
 * que sirve el ambiente.
 */
async function apiSession(email: string): Promise<ApiSession> {
  const config = (await (await fetch(`${baseUrl()}/app-config.json`)).json()) as {
    bffWebBaseUrl: string;
  };
  const api = await request.newContext({
    baseURL: config.bffWebBaseUrl,
    extraHTTPHeaders: { Origin: baseUrl() },
  });
  const created = await api.post('/v1/sessions', { data: { email, password: PASSWORD } });
  await expectStatus(created, 200, 'API POST /v1/sessions');
  return { api, token: ((await created.json()) as { access_token: string }).access_token };
}

/** Instante con el desfase de America/Bogota (UTC−5, sin horario de verano). */
function bogota(epochMs: number): string {
  return new Date(epochMs - 5 * 3_600_000).toISOString().slice(0, 19) + '-05:00';
}

/** Crea el borrador por API (HU015, ADR-027) y devuelve su `service_id`. */
async function createDraft(
  session: ApiSession,
  name: string,
  withAvailability: boolean,
): Promise<string> {
  const starts = Math.floor((Date.now() + 2 * DAY_MS) / 3_600_000) * 3_600_000;
  const created = await session.api.post('/v1/services', {
    headers: { Authorization: `Bearer ${session.token}`, 'Idempotency-Key': randomUUID() },
    data: {
      name,
      description: 'Servicio sintético creado por la prueba integrada de HU019.',
      category: 'COACHING',
      modality: 'VIRTUAL',
      price: { amount: '65000.00', currency: 'COP', billing_unit: 'SESSION' },
      ...(withAvailability
        ? {
            availability: [
              {
                starts_at: bogota(starts),
                ends_at: bogota(starts + 3_600_000),
                time_zone: 'America/Bogota',
                capacity: 4,
              },
            ],
          }
        : {}),
    },
  });
  await expectStatus(created, 201, 'API POST /v1/services');
  return ((await created.json()) as { service_id: string }).service_id;
}

async function openService(page: Page, serviceId: string): Promise<void> {
  await page.locator('mat-sidenav [data-menu-item="service-publish"]').click();
  await expect(page).toHaveURL(/\/profesional\/servicios\/publicacion$/);
  await page.locator(`li[data-service="${serviceId}"] a`).click();
  await expect(page).toHaveURL(new RegExp(`/profesional/servicios/publicacion/${serviceId}$`));
}

test.describe('HU019 Publicar servicios contra el BFF web @integrado', () => {
  test('CA1, CA3 y CA4: publica una sola vez aunque se pierda la respuesta, queda en el catálogo y un tercero no lo toca', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const providerEmail = uniqueEmail('profesional');
    const outsiderEmail = uniqueEmail('otro-profesional');
    const athleteEmail = uniqueEmail('deportista');
    const page = await newPage(browser);
    await register(page, providerEmail, 'Profesional de servicios');
    await register(await newPage(browser), outsiderEmail, 'Profesional de servicios');
    await register(await newPage(browser), athleteEmail, 'Deportista');

    const provider = await apiSession(providerEmail);
    const name = `Entrenamiento sintético HU019 ${Date.now()}`;
    const serviceId = await createDraft(provider, name, true);
    await login(page, providerEmail);
    await openService(page, serviceId);

    const detail = page.getByTestId('service-publish-detail');
    await expect(detail.getByTestId('service-detail-status')).toHaveText('Borrador');
    await expect(detail.getByTestId('requirement-price')).toContainText('(COP)');
    await expect(detail.getByTestId('requirement-billing-unit')).toHaveText('Por sesión');
    await expect(detail.getByTestId('requirement-availability')).toContainText(
      'Horarios futuros: 1',
    );

    // CA4: la primera publicación llega al BFF real, pero la respuesta se pierde en la
    // red. Los reintentos automáticos y el manual usan la misma Idempotency-Key.
    let lost: { key: string | null; status: number; version: number } | null = null;
    await page.route('**/v1/services/*/publish', async (route) => {
      const original = await route.fetch();
      lost ??= {
        key: await route.request().headerValue('idempotency-key'),
        status: original.status(),
        version: ((await original.json()) as { version: number }).version,
      };
      await route.abort('connectionfailed');
    });
    await detail.getByRole('button', { name: 'Publicar' }).click();
    await detail.getByRole('button', { name: 'Sí, publicar' }).click();
    await expect(detail.getByTestId('service-publish-error')).toContainText('No hay conexión', {
      timeout: 30_000,
    });
    await page.unrouteAll({ behavior: 'wait' });
    expect(lost, 'la primera publicación debía llegar al BFF').not.toBeNull();
    const first = lost!;
    expect(first.status, 'la primera publicación debía confirmarse').toBe(200);
    expect(first.key).toMatch(UUID);

    const retried = waitForOperation(page, 'POST', /^\/v1\/services\/[^/]+\/publish$/);
    await detail.getByRole('button', { name: 'Sí, publicar' }).click();
    const response = await retried;
    await expectStatus(response, 200, 'POST /v1/services/{id}/publish');
    expect(await response.request().headerValue('idempotency-key')).toBe(first.key);
    expect(await response.headerValue('idempotent-replayed')).toBe('true');
    const published = (await response.json()) as {
      service_id: string;
      status: string;
      version: number;
      published_at: string;
    };
    expect(published).toEqual(
      expect.objectContaining({ service_id: serviceId, status: 'PUBLISHED', version: 2 }),
    );
    expect(published.version).toBe(first.version);
    await expect(detail.getByTestId('service-published')).toContainText('Servicio publicado');
    await expect(detail.getByTestId('service-publish-replayed')).toBeVisible();
    await expect(detail.getByTestId('service-detail-status')).toHaveText('Publicado');

    // Sin proyección: la lista ya no lo muestra como borrador y sí entre los publicados.
    await expect(page.locator(`li[data-service="${serviceId}"]`)).toHaveCount(0);
    await page.getByTestId('services-tab-published').click();
    await expect(page.locator(`li[data-service="${serviceId}"]`)).toContainText('Publicado el');

    // CA4: otra clave sobre el servicio ya publicado devuelve su estado sin subir la versión.
    const again = await provider.api.post(`/v1/services/${serviceId}/publish`, {
      headers: { Authorization: `Bearer ${provider.token}`, 'Idempotency-Key': randomUUID() },
    });
    await expectStatus(again, 200, 'API POST publish (ya publicado)');
    expect(((await again.json()) as { version: number }).version).toBe(2);

    // CA3: otro profesional no ve ni publica el servicio ajeno.
    const outsider = await apiSession(outsiderEmail);
    const foreign = await outsider.api.get(`/v1/me/services/${serviceId}`, {
      headers: { Authorization: `Bearer ${outsider.token}` },
    });
    await expectStatus(foreign, 404, 'API GET /v1/me/services/{id} (ajeno)');
    expect((await errorOf(foreign)).code).toBe('service_not_found');
    const foreignPublish = await outsider.api.post(`/v1/services/${serviceId}/publish`, {
      headers: { Authorization: `Bearer ${outsider.token}`, 'Idempotency-Key': randomUUID() },
    });
    await expectStatus(foreignPublish, 404, 'API POST publish (ajeno)');

    // CA1: el deportista ya lo encuentra en el catálogo (HU020 lee la misma base).
    const athlete = await apiSession(athleteEmail);
    const from = new Date(Date.now()).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const to = new Date(Date.now() + 7 * DAY_MS).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const catalog = await athlete.api.get('/v1/services/availability', {
      headers: { Authorization: `Bearer ${athlete.token}` },
      params: { from, to, category: 'COACHING', limit: '50' },
    });
    await expectStatus(catalog, 200, 'API GET /v1/services/availability');
    const items = ((await catalog.json()) as { items: { service_id: string; name: string }[] })
      .items;
    expect(items.map((item) => item.service_id)).toContain(serviceId);
  });

  test('CA2: sin horarios futuros el backend enumera el requisito y el servicio sigue como borrador', async ({
    page,
  }) => {
    const email = uniqueEmail('profesional');
    await register(page, email, 'Profesional de servicios');
    const provider = await apiSession(email);
    const serviceId = await createDraft(
      provider,
      `Servicio sin horarios HU019 ${Date.now()}`,
      false,
    );
    await login(page, email);
    await openService(page, serviceId);

    const detail = page.getByTestId('service-publish-detail');
    await expect(detail.getByTestId('requirement-availability')).toContainText(
      'Sin horarios futuros.',
    );
    await expect(detail.getByTestId('service-no-upcoming')).toBeVisible();
    const rejected = waitForOperation(page, 'POST', /^\/v1\/services\/[^/]+\/publish$/);
    await detail.getByRole('button', { name: 'Publicar' }).click();
    await detail.getByRole('button', { name: 'Sí, publicar' }).click();
    const response = await rejected;
    await expectStatus(response, 422, 'POST /v1/services/{id}/publish');
    const body = (await response.json()) as {
      code: string;
      details: { field: string; issue: string }[];
    };
    expect(body.code).toBe('validation_error');
    expect(body.details).toContainEqual(
      expect.objectContaining({ field: 'availability', issue: 'required' }),
    );

    const violations = detail.getByTestId('service-publish-violations');
    await expect(violations).toBeFocused();
    await expect(violations).toContainText(
      'Disponibilidad futura: necesita al menos un horario futuro.',
    );
    await expect(detail.getByTestId('service-detail-status')).toHaveText('Borrador');

    const stored = await provider.api.get(`/v1/me/services/${serviceId}`, {
      headers: { Authorization: `Bearer ${provider.token}` },
    });
    await expectStatus(stored, 200, 'API GET /v1/me/services/{id}');
    expect(await stored.json()).toEqual(expect.objectContaining({ status: 'DRAFT', version: 1 }));
  });
});
