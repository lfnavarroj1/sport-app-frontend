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
 * HU018 de punta a punta: Angular → BFF web (composición de ADR-039) →
 * events-management, complementary-services y training-management, contra el
 * ambiente de `PLAYWRIGHT_BASE_URL`. Requiere `bff-web` 0.29.0 o posterior y
 * `events-management` 0.9.0 desplegados juntos, con los publicadores y proyectores
 * de Eventos y Servicios. Como pide ADR-039: el organizador ve su borrador y su
 * evento publicado; otro organizador no ve ese borrador; el profesional ve la
 * disponibilidad de su servicio y los eventos publicados; el deportista ve los
 * eventos publicados sin borradores. Nombres únicos por ejecución; cuentas
 * sintéticas.
 */
test.use({ timezoneId: 'America/Bogota' });

const PASSWORD = 'clave-sintetica-e2e-123';
const CALENDAR = /^\/v1\/me\/integrated-calendar$/;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

function baseUrl(): string {
  const url = process.env['PLAYWRIGHT_BASE_URL'];
  if (!url) {
    throw new Error('PLAYWRIGHT_BASE_URL es obligatoria para la suite integrada.');
  }
  return url.replace(/\/$/, '');
}

function uniqueEmail(role: string): string {
  return `e2e-hu018-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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

async function login(page: Page, email: string, home: RegExp): Promise<void> {
  await page.goto('/iniciar-sesion');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  const session = waitForOperation(page, 'POST', /^\/v1\/sessions$/);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expectStatus(await session, 200, 'POST /v1/sessions');
  // Navegar antes de llegar al inicio perdería la sesión recién creada.
  await expect(page).toHaveURL(home);
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

/** Instante con el desfase de America/Bogota (UTC−5, sin horario de verano). */
function bogota(epochMs: number): string {
  return new Date(epochMs - 5 * HOUR_MS).toISOString().slice(0, 19) + '-05:00';
}

/** Fecha local `YYYY-MM-DD` en Bogotá. */
function bogotaDay(epochMs: number): string {
  return new Date(epochMs - 5 * HOUR_MS).toISOString().slice(0, 10);
}

/** Crea un borrador de evento por API (HU021, ADR-028) y devuelve su `event_id`. */
async function createEvent(session: ApiSession, name: string, startsAtMs: number): Promise<string> {
  const created = await session.api.post('/v1/events', {
    headers: { Authorization: `Bearer ${session.token}`, 'Idempotency-Key': randomUUID() },
    data: {
      name,
      description: 'Evento sintético de la prueba integrada del calendario integrado.',
      discipline: 'Running',
      location: {
        name: 'Sede sintética E2E',
        address: 'Calle sintética 123',
        city: 'Bogotá',
        country_code: 'CO',
      },
      starts_at: bogota(startsAtMs),
      time_zone: 'America/Bogota',
      duration_minutes: 120,
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

/** Crea por API un servicio en borrador con un horario (HU015, ADR-027). */
async function createService(
  session: ApiSession,
  name: string,
  startsAtMs: number,
): Promise<string> {
  const created = await session.api.post('/v1/services', {
    headers: { Authorization: `Bearer ${session.token}`, 'Idempotency-Key': randomUUID() },
    data: {
      name,
      description: 'Servicio sintético de la prueba integrada del calendario integrado.',
      category: 'COACHING',
      modality: 'VIRTUAL',
      price: { amount: '65000.00', currency: 'COP', billing_unit: 'SESSION' },
      availability: [
        {
          starts_at: bogota(startsAtMs),
          ends_at: bogota(startsAtMs + HOUR_MS),
          time_zone: 'America/Bogota',
          capacity: 4,
        },
      ],
    },
  });
  await expectStatus(created, 201, 'API POST /v1/services');
  return ((await created.json()) as { service_id: string }).service_id;
}

/**
 * Abre el calendario por el menú, consulta en lista `[from, to]` (días de Bogotá)
 * y repite hasta que `expected` aparezca: cada dominio proyecta a su ritmo (CA2).
 */
async function showUntil(
  page: Page,
  menuItem: string,
  days: { from: string; to: string },
  expected: string[],
): Promise<void> {
  await page.locator(`mat-sidenav [data-menu-item="${menuItem}"]`).click();
  await page.getByRole('radio', { name: 'Lista' }).click();
  await page.getByLabel('Desde').fill(days.from);
  await page.getByLabel('Hasta').fill(days.to);
  const list = page.getByTestId('integrated-list');
  await expect(async () => {
    const response = waitForOperation(page, 'GET', CALENDAR);
    await page.getByRole('button', { name: 'Consultar' }).click();
    await expectStatus(await response, 200, 'GET /v1/me/integrated-calendar');
    for (const title of expected) {
      await expect(list.getByText(title, { exact: true })).toBeVisible({ timeout: 2_000 });
    }
  }, 'las fuentes debían quedar proyectadas').toPass({ timeout: 90_000 });
}

test.describe('HU018 Integrar servicios y eventos en calendario contra el BFF web @integrado', () => {
  test('CA1, CA3 y CA4: cada actor ve sus fuentes; un borrador solo lo ve su propietario', async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const run = Math.random().toString(36).slice(2, 8);
    // Mañana a las 00:00 de Bogotá; el periodo cubre 30 días.
    const today = Date.now();
    const days = { from: bogotaDay(today + DAY_MS), to: bogotaDay(today + 30 * DAY_MS) };
    const at = (offsetDays: number, hour: number) =>
      Date.parse(
        `${bogotaDay(today + offsetDays * DAY_MS)}T${String(hour).padStart(2, '0')}:00:00-05:00`,
      );

    const ownerEmail = uniqueEmail('organizador');
    const otherEmail = uniqueEmail('otro-organizador');
    const providerEmail = uniqueEmail('profesional');
    const athleteEmail = uniqueEmail('deportista');
    const ownerPage = await newPage(browser);
    const otherPage = await newPage(browser);
    const providerPage = await newPage(browser);
    const athletePage = await newPage(browser);
    await register(ownerPage, ownerEmail, 'Organizador de eventos');
    await register(otherPage, otherEmail, 'Organizador de eventos');
    await register(providerPage, providerEmail, 'Profesional de servicios');
    await register(athletePage, athleteEmail, 'Deportista');

    const owner = await apiSession(ownerEmail);
    const provider = await apiSession(providerEmail);
    const draftName = `Borrador HU018 ${run}`;
    const publishedName = `Publicado HU018 ${run}`;
    const serviceName = `Servicio HU018 ${run}`;
    await createEvent(owner, draftName, at(12, 7));
    await publish(owner, await createEvent(owner, publishedName, at(10, 7)));
    await createService(provider, serviceName, at(3, 9));

    // Organizador: su borrador y su evento publicado, con fuente y estado (CA1, CA4).
    await login(ownerPage, ownerEmail, /\/organizador\/inicio$/);
    await showUntil(ownerPage, 'integrated-calendar', days, [draftName, publishedName]);
    const ownList = ownerPage.getByTestId('integrated-list');
    await expect(
      ownList.locator('[data-source="OWN_EVENT"]', { hasText: draftName }),
    ).toContainText('Borrador');
    await expect(
      ownList.locator('[data-source="OWN_EVENT"]', { hasText: publishedName }),
    ).toContainText('Zona: America/Bogota');

    // Otro organizador: el borrador ajeno no aparece (CA4).
    await login(otherPage, otherEmail, /\/organizador\/inicio$/);
    const otherCalendar = waitForOperation(otherPage, 'GET', CALENDAR);
    await otherPage.locator('mat-sidenav [data-menu-item="integrated-calendar"]').click();
    const otherBody = (await (await otherCalendar).json()) as { items: { title: string }[] };
    expect(otherBody.items.map((item) => item.title)).not.toContain(draftName);

    // Profesional: la disponibilidad de su servicio y los eventos publicados (CA1).
    await login(providerPage, providerEmail, /\/profesional\/inicio$/);
    await showUntil(providerPage, 'integrated-calendar', days, [serviceName, publishedName]);
    const providerList = providerPage.getByTestId('integrated-list');
    await expect(
      providerList.locator('[data-source="OWN_SERVICE_AVAILABILITY"]', { hasText: serviceName }),
    ).toContainText('Borrador');
    await expect(providerList.getByText(draftName, { exact: true })).toHaveCount(0);

    // Deportista: los eventos publicados, nunca un borrador (CA1, CA4).
    await login(athletePage, athleteEmail, /\/deportista\/inicio$/);
    await expect(async () => {
      await athletePage.reload();
      await expect(
        athletePage.locator('mat-sidenav [data-menu-item="sport-calendar"]'),
      ).toBeVisible({ timeout: 5_000 });
    }, 'el plan FREE debía activarse con calendar.sport.view').toPass({ timeout: 90_000 });
    await showUntil(athletePage, 'sport-calendar', days, [publishedName]);
    await expect(
      athletePage.getByTestId('integrated-list').getByText(draftName, { exact: true }),
    ).toHaveCount(0);

    // CA6: el BFF rechaza un periodo de más de 92 días con 422 y details.
    const tooLong = await owner.api.get('/v1/me/integrated-calendar', {
      headers: { Authorization: `Bearer ${owner.token}` },
      params: {
        from: new Date(today).toISOString(),
        to: new Date(today + 93 * DAY_MS).toISOString(),
      },
    });
    await expectStatus(tooLong, 422, 'API GET /v1/me/integrated-calendar (93 días)');
    expect(((await tooLong.json()) as { details: { issue: string }[] }).details[0].issue).toBe(
      'out_of_range',
    );
  });
});
