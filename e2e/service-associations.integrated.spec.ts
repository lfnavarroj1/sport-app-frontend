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
 * HU017 de punta a punta: Angular → BFF web → Afiliación (capacidad) →
 * complementary-services (base única, sin eventos), contra el ambiente de
 * `PLAYWRIGHT_BASE_URL`. Requiere `bff-web` 0.25.0 o superior y
 * `complementary-services` 0.5.0 con la migración `0005_service_association`.
 * Un profesional sintético crea y publica por API un servicio de medicina
 * deportiva (HU015, HU019); un deportista sintético sube a `PREMIUM` por API
 * (HU016) y asocia y quita el servicio desde la web. Las cuentas usan correos
 * únicos por ejecución. Ante un fallo, el mensaje deja la operación, el estado,
 * el `code` y el `correlation_id`.
 */

const PASSWORD = 'clave-sintetica-e2e-123';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DAY_MS = 86_400_000;
const ASSOCIATIONS = '/v1/me/service-associations';

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
  return `e2e-hu017-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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

function auth(session: ApiSession, extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${session.token}`, ...extra };
}

/** Instante con el desfase de America/Bogota (UTC−5, sin horario de verano). */
function bogota(epochMs: number): string {
  return new Date(epochMs - 5 * 3_600_000).toISOString().slice(0, 19) + '-05:00';
}

/** Crea y publica por API (HU015, HU019) un servicio de medicina deportiva. */
async function publishMedicalService(provider: ApiSession, name: string): Promise<string> {
  const starts = Math.floor((Date.now() + 2 * DAY_MS) / 3_600_000) * 3_600_000;
  const created = await provider.api.post('/v1/services', {
    headers: auth(provider, { 'Idempotency-Key': randomUUID() }),
    data: {
      name,
      description: 'Servicio médico sintético creado por la prueba integrada de HU017.',
      category: 'SPORTS_MEDICINE',
      modality: 'IN_PERSON',
      price: { amount: '90000.00', currency: 'COP', billing_unit: 'SESSION' },
      availability: [
        {
          starts_at: bogota(starts),
          ends_at: bogota(starts + 3_600_000),
          time_zone: 'America/Bogota',
          capacity: 3,
        },
      ],
    },
  });
  await expectStatus(created, 201, 'API POST /v1/services');
  const serviceId = ((await created.json()) as { service_id: string }).service_id;
  const published = await provider.api.post(`/v1/services/${serviceId}/publish`, {
    headers: auth(provider, { 'Idempotency-Key': randomUUID() }),
  });
  await expectStatus(published, 200, 'API POST /v1/services/{id}/publish');
  return serviceId;
}

/** Espera el plan `FREE` activo (ADR-024) y cambia por API al plan indicado (HU016). */
async function changePlan(athlete: ApiSession, planCode: string, periodicity: string) {
  let version = 0;
  await expect(async () => {
    const current = await athlete.api.get('/v1/me/subscription', { headers: auth(athlete) });
    await expectStatus(current, 200, 'API GET /v1/me/subscription');
    const body = (await current.json()) as { status: string; version: number | null };
    expect(body.status, 'la suscripción debía quedar ACTIVE').toBe('ACTIVE');
    version = body.version ?? 0;
  }).toPass({ timeout: 90_000, intervals: [2_000, 5_000] });
  const changed = await athlete.api.post('/v1/me/subscription/changes', {
    headers: auth(athlete, { 'Idempotency-Key': randomUUID() }),
    data: { plan_code: planCode, periodicity, expected_subscription_version: version },
  });
  await expectStatus(changed, 200, `API POST /v1/me/subscription/changes (${planCode})`);
}

async function login(page: Page, email: string): Promise<void> {
  await page.goto('/iniciar-sesion');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  const session = waitForOperation(page, 'POST', /^\/v1\/sessions$/);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expectStatus(await session, 200, 'POST /v1/sessions');
  // Navegar antes de llegar al inicio perdería la sesión recién creada.
  await expect(page).toHaveURL(/\/deportista\/inicio$/);
}

test.describe('HU017 Asociar servicios médicos deportivos contra el BFF web @integrado', () => {
  test('CA1–CA5: el deportista PREMIUM asocia y quita un servicio médico publicado real', async ({
    browser,
    page,
  }) => {
    test.setTimeout(240_000);
    const providerEmail = uniqueEmail('profesional');
    const athleteEmail = uniqueEmail('deportista');
    await register(await newPage(browser), providerEmail, 'Profesional de servicios');
    await register(page, athleteEmail, 'Deportista');
    const provider = await apiSession(providerEmail);
    const athlete = await apiSession(athleteEmail);
    const name = `Medicina deportiva E2E ${Date.now()}`;
    const serviceId = await publishMedicalService(provider, name);
    await changePlan(athlete, 'PREMIUM', 'QUARTERLY');

    // Web: «Servicios médicos y deportivos» con «Mis servicios asociados».
    await login(page, athleteEmail);
    const firstList = waitForOperation(page, 'GET', /^\/v1\/me\/service-associations$/);
    await page.locator('mat-sidenav [data-menu-item="sports-medicine"]').click();
    await expect(page).toHaveURL(/\/deportista\/servicios\/medico-deportivos$/);
    await expectStatus(await firstList, 200, 'GET /v1/me/service-associations');
    const item = page.locator(
      `[data-testid="availability-list"] > li[data-service="${serviceId}"]`,
    );
    await expect(item).toBeVisible();

    // CA1 y CA4: asociar tras confirmar; una sola asociación ACTIVE.
    await item.getByRole('button', { name: `Asociar ${name}` }).click();
    await expect(item.getByTestId('association-confirm')).toContainText(
      'no comparte tus datos de salud',
    );
    const associated = waitForOperation(page, 'POST', /^\/v1\/me\/service-associations$/);
    await item.getByRole('button', { name: 'Sí, asociar', exact: true }).click();
    const response = await associated;
    await expectStatus(response, 201, 'POST /v1/me/service-associations');
    const association = (await response.json()) as {
      association_id: string;
      status: string;
      ended_at: string | null;
    };
    expect(association.association_id).toMatch(UUID);
    expect(association.status).toBe('ACTIVE');
    expect(await response.request().headerValue('idempotency-key')).toMatch(UUID);
    await expect(item.getByTestId('association-badge')).toHaveText('Asociado a tu perfil');
    const listed = page.locator(
      `[data-testid="associations-list"] > li[data-association="${association.association_id}"]`,
    );
    await expect(listed).toContainText(name);

    // CA3: la misma clave devuelve la original; otra clave responde 409 con la activa.
    const replay = await athlete.api.post(ASSOCIATIONS, {
      headers: auth(athlete, {
        'Idempotency-Key': (await response.request().headerValue('idempotency-key'))!,
      }),
      data: { service_id: serviceId },
    });
    await expectStatus(replay, 201, 'API POST asociación (misma clave)');
    expect(replay.headers()['idempotent-replayed']).toBe('true');
    expect(((await replay.json()) as { association_id: string }).association_id).toBe(
      association.association_id,
    );
    const duplicate = await athlete.api.post(ASSOCIATIONS, {
      headers: auth(athlete, { 'Idempotency-Key': randomUUID() }),
      data: { service_id: serviceId },
    });
    await expectStatus(duplicate, 409, 'API POST asociación (duplicada)');
    const conflict = (await duplicate.json()) as {
      code: string;
      details: { field: string; issue: string }[];
    };
    expect(conflict.code).toBe('association_exists');
    expect(conflict.details).toContainEqual({
      field: 'association_id',
      issue: association.association_id,
    });

    // CA2: un servicio inexistente responde 404 service_not_found.
    const missing = await athlete.api.post(ASSOCIATIONS, {
      headers: auth(athlete, { 'Idempotency-Key': randomUUID() }),
      data: { service_id: randomUUID() },
    });
    await expectStatus(missing, 404, 'API POST asociación (servicio inexistente)');
    expect((await errorOf(missing)).code).toBe('service_not_found');

    // CA5: quitar desde la lista tras confirmar; la relación queda INACTIVE en el historial.
    await listed.getByRole('button', { name: `Quitar ${name}` }).click();
    const removed = waitForOperation(page, 'DELETE', /^\/v1\/me\/service-associations\/[^/]+$/);
    await listed.getByRole('button', { name: 'Sí, quitar', exact: true }).click();
    await expectStatus(await removed, 204, 'DELETE /v1/me/service-associations/{id}');
    await expect(page.getByTestId('associations-notice')).toContainText(`Quitaste «${name}»`);
    await expect(item.getByRole('button', { name: `Asociar ${name}` })).toBeVisible();

    const history = waitForOperation(page, 'GET', /^\/v1\/me\/service-associations$/);
    await page.getByTestId('associations-history').getByRole('checkbox').check();
    const historyResponse = await history;
    await expectStatus(historyResponse, 200, 'GET /v1/me/service-associations?status=ALL');
    expect(new URL(historyResponse.url()).searchParams.get('status')).toBe('ALL');
    await expect(listed).toContainText('Quitado');
    await expect(listed.getByTestId('association-ended-at')).toBeVisible();

    const again = await athlete.api.delete(`${ASSOCIATIONS}/${association.association_id}`, {
      headers: auth(athlete),
    });
    await expectStatus(again, 204, 'API DELETE asociación (repetida)');
    const all = await athlete.api.get(ASSOCIATIONS, {
      headers: auth(athlete),
      params: { status: 'ALL' },
    });
    await expectStatus(all, 200, 'API GET asociaciones ALL');
    const stored = ((await all.json()) as { items: (typeof association)[] }).items.find(
      (entry) => entry.association_id === association.association_id,
    );
    expect(stored?.status).toBe('INACTIVE');
    expect(stored?.ended_at).toBeTruthy();

    // CA2: de vuelta en FREE, la consulta responde 403 capability_required.
    await changePlan(athlete, 'FREE', 'NONE');
    const forbidden = await athlete.api.get(ASSOCIATIONS, { headers: auth(athlete) });
    await expectStatus(forbidden, 403, 'API GET asociaciones (FREE)');
    expect((await errorOf(forbidden)).code).toBe('capability_required');
  });
});
