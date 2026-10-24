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
 * HU025 de punta a punta: Angular → BFF web → events-management (tarifa en
 * escritura, `evento.tarifa_actualizada.v1` → `event_read`), contra el ambiente de
 * `PLAYWRIGHT_BASE_URL`. Requiere `bff-web` 0.26.0 y `events-management` 0.8.0
 * (migraciones `0005_event_fee` y `0007_event_read_fee`) desplegados juntos. La
 * inscripción real la produce HU041 en `bff-mobile` (`PLAYWRIGHT_BFF_MOBILE_URL`);
 * la web nunca llama a `bff-mobile`. El evento se crea y publica por la API de
 * `bff-web` (HU021 y HU024). Las cuentas son sintéticas, con correos únicos.
 */

const FEE = /^\/v1\/events\/[^/]+\/fee$/;

const PASSWORD = 'clave-sintetica-e2e-123';

function baseUrl(): string {
  const url = process.env['PLAYWRIGHT_BASE_URL'];
  if (!url) {
    throw new Error('PLAYWRIGHT_BASE_URL es obligatoria para la suite integrada.');
  }
  return url.replace(/\/$/, '');
}

/** URL pública de `bff-mobile`, solo para producir la inscripción de HU041. */
function bffMobileUrl(): string {
  const url = process.env['PLAYWRIGHT_BFF_MOBILE_URL'];
  if (!url) {
    throw new Error(
      'PLAYWRIGHT_BFF_MOBILE_URL es obligatoria para inscribir al deportista (HU041).',
    );
  }
  return url;
}

function uniqueEmail(role: string): string {
  return `e2e-hu025-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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

async function newPage(browser: Browser): Promise<Page> {
  return (await browser.newContext()).newPage();
}

async function register(page: Page, email: string, actor: string, name: string): Promise<void> {
  await page.goto('/registro');
  await page.getByLabel('Nombre completo').fill(name);
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Tipo de usuario').click();
  await page.getByRole('option', { name: actor }).click();
  await page.getByLabel(/Acepto las políticas/).check();
  const created = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/v1/users',
  );
  await page.getByRole('button', { name: 'Registrarme' }).click();
  await expectStatus(await created, 201, 'POST /v1/users');
}

async function login(page: Page, email: string): Promise<void> {
  await page.goto('/iniciar-sesion');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).toHaveURL(/\/organizador\/inicio$/);
}

/** Sesión propia de una API (contexto aparte: no comparte la cookie con el navegador). */
async function apiSession(
  baseURL: string,
  email: string,
): Promise<{ api: APIRequestContext; token: string }> {
  const api = await request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseUrl() } });
  const session = await api.post('/v1/sessions', { data: { email, password: PASSWORD } });
  await expectStatus(session, 200, `${baseURL} POST /v1/sessions`);
  return { api, token: ((await session.json()) as { access_token: string }).access_token };
}

async function bffWebUrl(): Promise<string> {
  const config = (await (await fetch(`${baseUrl()}/app-config.json`)).json()) as {
    bffWebBaseUrl: string;
  };
  return config.bffWebBaseUrl;
}

/** `starts_at` con el desfase de America/Bogota (UTC−5, sin horario de verano). */
function bogotaStartsAt(epochMs: number): string {
  return new Date(epochMs - 5 * 3_600_000).toISOString().slice(0, 19) + '-05:00';
}

/** Crea un borrador por API (HU021) y, si se pide, lo publica (HU024). */
async function createEvent(
  session: { api: APIRequestContext; token: string },
  name: string,
  publish: boolean,
): Promise<string> {
  const headers = () => ({
    Authorization: `Bearer ${session.token}`,
    'Idempotency-Key': randomUUID(),
  });
  const created = await session.api.post('/v1/events', {
    headers: headers(),
    data: {
      name,
      description: 'Carrera recreativa de diez kilómetros para corredores aficionados.',
      discipline: 'Running',
      location: {
        name: 'Parque Metropolitano Simón Bolívar',
        address: 'Avenida Calle 63 # 60-50',
        city: 'Bogotá',
        country_code: 'CO',
      },
      starts_at: bogotaStartsAt(Date.now() + 30 * 86_400_000),
      time_zone: 'America/Bogota',
      duration_minutes: 180,
      capacity: 500,
    },
  });
  await expectStatus(created, 201, 'API POST /v1/events');
  const eventId = ((await created.json()) as { event_id: string }).event_id;
  if (publish) {
    const published = await session.api.post(`/v1/events/${eventId}/publish`, {
      headers: headers(),
    });
    await expectStatus(published, 200, 'API POST /v1/events/{id}/publish');
  }
  return eventId;
}

/** Inscribe al deportista con HU041; reintenta mientras el evento publicado se proyecta. */
async function registerAthlete(email: string, eventId: string): Promise<void> {
  const mobile = await apiSession(bffMobileUrl(), email);
  try {
    await expect(async () => {
      const registered = await mobile.api.post(`/v1/events/${eventId}/registrations`, {
        headers: { Authorization: `Bearer ${mobile.token}`, 'Idempotency-Key': randomUUID() },
      });
      await expectStatus(registered, 201, 'bff-mobile POST /v1/events/{id}/registrations');
    }, 'el evento publicado debía quedar disponible para inscribirse (proyección)').toPass({
      timeout: 60_000,
      intervals: [2_000, 5_000],
    });
  } finally {
    await mobile.api.dispose();
  }
}

const editor = (page: Page) => page.getByTestId('event-fee-editor');

async function openEvent(page: Page, eventId: string): Promise<void> {
  await page.locator('mat-sidenav [data-menu-item="event-pricing"]').click();
  await expect(page).toHaveURL(/\/organizador\/eventos\/tarifas$/);
  await page.locator(`li[data-event="${eventId}"]`).getByRole('link').click();
  await expect(editor(page)).toBeVisible();
}

async function saveFee(page: Page, value: string): Promise<Response> {
  await editor(page).getByLabel('Valor de la tarifa').fill(value);
  await editor(page).getByRole('button', { name: 'Guardar tarifa' }).click();
  const command = page.waitForResponse(
    (r) => r.request().method() === 'PUT' && FEE.test(new URL(r.url()).pathname),
  );
  await editor(page).getByRole('button', { name: 'Confirmar' }).click();
  return command;
}

test.describe('HU025 Tarifas de eventos contra el BFF web @integrado', () => {
  test('CA1, CA4 y CA5: asigna la tarifa de un evento publicado con un inscrito real y el detalle público la muestra', async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const suffix = Math.random().toString(36).slice(2, 8);
    const organizerEmail = uniqueEmail('organizador');
    const athleteEmail = uniqueEmail('deportista');
    const eventName = `Carrera con tarifa ${suffix}`;

    const page = await newPage(browser);
    const athlete = await newPage(browser);
    await register(page, organizerEmail, 'Organizador de eventos', 'Organizadora Sintética E2E');
    await register(athlete, athleteEmail, 'Deportista', `Deportista Sintética ${suffix}`);

    const organizer = await apiSession(await bffWebUrl(), organizerEmail);
    const eventId = await createEvent(organizer, eventName, true);
    await registerAthlete(athleteEmail, eventId);

    await login(page, organizerEmail);
    await openEvent(page, eventId);
    // CA4: `registration_count` sale de la base de escritura: la inscripción ya cuenta.
    await expect(editor(page).getByTestId('fee-registrations')).toHaveText('1');
    await expect(editor(page).getByTestId('fee-registrations-warning')).toContainText(
      'Las inscripciones existentes conservan su tarifa',
    );
    const version = Number(await editor(page).getByTestId('fee-version').textContent());

    // CA1: 200 con la tarifa y la versión incrementada, sin esperar la proyección.
    const assigned = await saveFee(page, '85.000');
    await expectStatus(assigned, 200, 'PUT /v1/events/{id}/fee');
    const command = (await assigned.json()) as {
      fee: { amount: string; currency: string };
      version: number;
      registration_count: number;
    };
    expect(command.fee).toEqual({ amount: '85000.00', currency: 'COP' });
    expect(command.version).toBe(version + 1);
    expect(command.registration_count).toBe(1);
    await expect(editor(page).getByTestId('fee-result')).toContainText('Tarifa asignada');
    await expect(editor(page).getByTestId('fee-result-version')).toHaveText(String(version + 1));
    await expect(editor(page).getByTestId('fee-result-registrations')).toHaveText('1');

    // CA1: el detalle público muestra la tarifa una vez proyectada.
    await expect(async () => {
      const detail = await organizer.api.get(`/v1/events/${eventId}`, {
        headers: { Authorization: `Bearer ${organizer.token}` },
      });
      await expectStatus(detail, 200, 'API GET /v1/events/{id}');
      expect(((await detail.json()) as { fee: unknown }).fee).toEqual({
        amount: '85000.00',
        currency: 'COP',
      });
    }, 'la tarifa debía quedar proyectada en event_read').toPass({
      timeout: 60_000,
      intervals: [2_000, 5_000],
    });

    // CA5: gratuito con otra clave; la tarifa sigue siendo informativa (sin cobro).
    const free = await saveFee(page, '0');
    await expectStatus(free, 200, 'PUT /v1/events/{id}/fee (gratuito)');
    await expect(editor(page).getByTestId('fee-result-fee')).toHaveText('Gratuito');
    await expect(editor(page).getByTestId('fee-result')).toContainText('no genera cobros');
    await organizer.api.dispose();
  });

  test('CA3: una versión obsoleta responde 409 y la web ofrece actualizar antes de reintentar', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const suffix = Math.random().toString(36).slice(2, 8);
    const organizerEmail = uniqueEmail('organizador');
    const page = await newPage(browser);
    await register(page, organizerEmail, 'Organizador de eventos', 'Organizadora Sintética E2E');
    const organizer = await apiSession(await bffWebUrl(), organizerEmail);
    const eventId = await createEvent(organizer, `Borrador con tarifa ${suffix}`, false);

    await login(page, organizerEmail);
    await openEvent(page, eventId);
    const version = Number(await editor(page).getByTestId('fee-version').textContent());

    // Otra sesión cambia la tarifa mientras la pantalla conserva la versión anterior.
    const other = await organizer.api.put(`/v1/events/${eventId}/fee`, {
      headers: { Authorization: `Bearer ${organizer.token}`, 'Idempotency-Key': randomUUID() },
      data: { amount: '50000.00', currency: 'COP', expected_version: version },
    });
    await expectStatus(other, 200, 'API PUT /v1/events/{id}/fee');

    const stale = await saveFee(page, '60000');
    await expectStatus(stale, 409, 'PUT /v1/events/{id}/fee (versión obsoleta)');
    await expect(editor(page).getByTestId('fee-conflict')).toContainText(
      `versión vigente: ${version + 1}`,
    );
    await editor(page).getByRole('button', { name: 'Actualizar evento' }).click();
    await expect(editor(page).getByTestId('fee-version')).toHaveText(String(version + 1));
    await expect(editor(page).getByLabel('Valor de la tarifa')).toHaveValue('50000');

    const retried = await saveFee(page, '60000');
    await expectStatus(retried, 200, 'PUT /v1/events/{id}/fee (tras actualizar)');
    await expect(editor(page).getByTestId('fee-result-version')).toHaveText(String(version + 2));
    await organizer.api.dispose();
  });
});
