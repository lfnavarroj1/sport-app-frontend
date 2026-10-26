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
 * HU023 de punta a punta: Angular → BFF web → events-management (`event_read`),
 * contra el ambiente de `PLAYWRIGHT_BASE_URL`. Requiere `bff-web` 0.17.0 o
 * posterior y `events-management` 0.6.0 desplegados juntos, con el publicador y
 * el proyector de Eventos. Como fija la tarea y ADR-040: otro organizador crea y
 * publica por API (HU021 y HU024) dos eventos que se solapan con el borrador
 * propio, uno en la misma ciudad y otro sin nada en común. Ciudad y disciplinas
 * son únicas por ejecución para no cruzarse con datos de otras corridas. Las
 * cuentas son sintéticas.
 */
test.use({ timezoneId: 'America/Bogota' });

const PASSWORD = 'clave-sintetica-e2e-123';
const CALENDAR = /^\/v1\/events$/;
const DAY_MS = 86_400_000;

function baseUrl(): string {
  const url = process.env['PLAYWRIGHT_BASE_URL'];
  if (!url) {
    throw new Error('PLAYWRIGHT_BASE_URL es obligatoria para la suite integrada.');
  }
  return url.replace(/\/$/, '');
}

function uniqueEmail(role: string): string {
  return `e2e-hu023-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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
  return (await browser.newContext({ timezoneId: 'America/Bogota' })).newPage();
}

async function register(page: Page, email: string): Promise<void> {
  await page.goto('/registro');
  await page.getByLabel('Nombre completo').fill('Persona Sintética E2E');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Tipo de usuario').click();
  await page.getByRole('option', { name: 'Organizador de eventos' }).click();
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
  await expect(page).toHaveURL(/\/organizador\/inicio$/);
}

interface ApiSession {
  readonly api: APIRequestContext;
  readonly token: string;
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
  const login = await api.post('/v1/sessions', { data: { email, password: PASSWORD } });
  await expectStatus(login, 200, 'API POST /v1/sessions');
  return { api, token: ((await login.json()) as { access_token: string }).access_token };
}

/** `starts_at` con el desfase de America/Bogota (UTC−5, sin horario de verano). */
function bogotaStartsAt(epochMs: number): string {
  return new Date(epochMs - 5 * 3_600_000).toISOString().slice(0, 19) + '-05:00';
}

/** Crea un borrador por API (HU021, ADR-028) y devuelve su `event_id`. */
async function createDraft(
  session: ApiSession,
  event: { name: string; discipline: string; city: string; startsAtMs: number },
): Promise<string> {
  const created = await session.api.post('/v1/events', {
    headers: { Authorization: `Bearer ${session.token}`, 'Idempotency-Key': randomUUID() },
    data: {
      name: event.name,
      description: 'Evento sintético de la prueba integrada del calendario de eventos.',
      discipline: event.discipline,
      location: {
        name: 'Sede sintética E2E',
        address: 'Calle sintética 123',
        city: event.city,
        country_code: 'CO',
      },
      starts_at: bogotaStartsAt(event.startsAtMs),
      time_zone: 'America/Bogota',
      duration_minutes: 180,
      capacity: 100,
    },
  });
  await expectStatus(created, 201, 'API POST /v1/events');
  return ((await created.json()) as { event_id: string }).event_id;
}

/** Publica por API (HU024, ADR-033). */
async function publish(session: ApiSession, eventId: string): Promise<void> {
  const published = await session.api.post(`/v1/events/${eventId}/publish`, {
    headers: { Authorization: `Bearer ${session.token}`, 'Idempotency-Key': randomUUID() },
  });
  await expectStatus(published, 200, 'API POST /v1/events/{event_id}/publish');
}

/** Fecha local `YYYY-MM-DD` en Bogotá. */
function bogotaDay(epochMs: number): string {
  return new Date(epochMs - 5 * 3_600_000).toISOString().slice(0, 10);
}

test.describe('HU023 Consultar calendario de eventos contra el BFF web @integrado', () => {
  test('CA1–CA4: el organizador ve los publicados filtrados y las coincidencias de su borrador', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const run = Math.random().toString(36).slice(2, 8);
    const city = `Ciudad E2E ${run}`;
    // Un día lejano y aleatorio de 2028, a las 10:00 de Bogotá, para no cruzarse con otras corridas.
    const startsAtMs = Date.UTC(2028, 1, 1, 15) + Math.floor(Math.random() * 300) * DAY_MS;
    const day = bogotaDay(startsAtMs);
    const ownerEmail = uniqueEmail('organizador');
    const otherEmail = uniqueEmail('otro-organizador');
    const page = await newPage(browser);
    await register(page, ownerEmail);
    await register(await newPage(browser), otherEmail);

    const owner = await apiSession(ownerEmail);
    const other = await apiSession(otherEmail);
    const draftName = `Borrador E2E ${run}`;
    const sameCityName = `Publicado misma ciudad ${run}`;
    const unrelatedName = `Publicado sin relación ${run}`;
    const draftId = await createDraft(owner, {
      name: draftName,
      discipline: `Disciplina A ${run}`,
      city,
      startsAtMs,
    });
    const sameCityId = await createDraft(other, {
      name: sameCityName,
      discipline: `Disciplina B ${run}`,
      city,
      startsAtMs: startsAtMs + 3_600_000,
    });
    const unrelatedId = await createDraft(other, {
      name: unrelatedName,
      discipline: `Disciplina C ${run}`,
      city: `Otra ciudad E2E ${run}`,
      startsAtMs: startsAtMs + 3_600_000,
    });
    await publish(other, sameCityId);
    await publish(other, unrelatedId);

    // CA1: los dos publicados aparecen en el periodo una vez proyectados; el borrador no.
    await login(page, ownerEmail);
    await page.locator('mat-sidenav [data-menu-item="event-calendar"]').click();
    await expect(page).toHaveURL(/\/organizador\/eventos\/calendario$/);
    await page.getByRole('radio', { name: 'Lista' }).click();
    await page.getByLabel('Desde').fill(day);
    await page.getByLabel('Hasta').fill(day);
    const list = page.getByTestId('calendar-list');
    await expect(async () => {
      const response = waitForOperation(page, 'GET', CALENDAR);
      await page.getByRole('button', { name: 'Consultar' }).click();
      await expectStatus(await response, 200, 'GET /v1/events');
      await expect(list.locator(`li[data-event="${sameCityId}"]`)).toBeVisible({ timeout: 2_000 });
      await expect(list.locator(`li[data-event="${unrelatedId}"]`)).toBeVisible({ timeout: 2_000 });
    }, 'los publicados debían quedar proyectados en event_read').toPass({ timeout: 60_000 });
    await expect(list.locator(`li[data-event="${draftId}"]`)).toHaveCount(0);
    await expect(list.locator(`li[data-event="${sameCityId}"]`)).toContainText(
      'Zona del evento: America/Bogota',
    );

    // CA1: el filtro por ciudad, en minúsculas, deja solo el de la misma ciudad.
    await page.getByLabel('Ciudad').fill(city.toLowerCase());
    const filtered = waitForOperation(page, 'GET', CALENDAR);
    await page.getByRole('button', { name: 'Consultar' }).click();
    const filteredBody = (await (await filtered).json()) as {
      items: { event_id: string; organizer_id?: string }[];
    };
    expect(filteredBody.items.map((item) => item.event_id)).toEqual([sameCityId]);
    expect(filteredBody.items[0]).not.toHaveProperty('organizer_id');
    await expect(list.locator('li')).toHaveCount(1);

    // CA2: el borrador propio coincide solo con el de la misma ciudad, con su motivo.
    await page.getByRole('combobox', { name: 'Mi evento' }).click();
    const conflictsResponse = waitForOperation(page, 'GET', /^\/v1\/me\/events\/[^/]+\/conflicts$/);
    await page.getByRole('option', { name: new RegExp(draftName) }).click();
    await expectStatus(await conflictsResponse, 200, 'GET /v1/me/events/{event_id}/conflicts');
    const conflicts = page.getByTestId('calendar-conflicts-list');
    await expect(conflicts.locator(`li[data-conflict="${sameCityId}"]`)).toContainText(
      'Coincide: misma ciudad',
    );
    await expect(conflicts.locator(`li[data-conflict="${unrelatedId}"]`)).toHaveCount(0);
    await expect(list.locator(`li[data-event="${sameCityId}"]`)).toContainText('Coincide');

    // CA2: el evento de otro organizador responde 404 aunque se pida directamente.
    const foreign = await owner.api.get(`/v1/me/events/${sameCityId}/conflicts`, {
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    await expectStatus(foreign, 404, 'API GET /v1/me/events/{ajeno}/conflicts');
    expect((await errorOf(foreign)).code).toBe('event_not_found');

    // CA3: el BFF rechaza un periodo mayor de 92 días con 422 y details.
    const tooLong = await owner.api.get('/v1/events', {
      headers: { Authorization: `Bearer ${owner.token}` },
      params: {
        from: new Date(startsAtMs).toISOString(),
        to: new Date(startsAtMs + 93 * DAY_MS).toISOString(),
      },
    });
    await expectStatus(tooLong, 422, 'API GET /v1/events (93 días)');
    expect(((await tooLong.json()) as { details: { field: string }[] }).details[0].field).toBe(
      'query.to',
    );
  });
});
