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
 * HU022 de punta a punta: Angular → BFF web → events-management
 * (`event_registration_read`) y users-management (`directory-lookup`), contra el
 * ambiente de `PLAYWRIGHT_BASE_URL`. Requiere `bff-web` 0.22.0,
 * `events-management` 0.7.0 con la migración `0006_registration_event_order` y
 * `users-management` 0.11.0 desplegados juntos. La inscripción real la produce
 * HU041 en `bff-mobile` (`PLAYWRIGHT_BFF_MOBILE_URL`), como lo haría la app móvil;
 * la web nunca llama a `bff-mobile`. El evento se crea y publica por la API de
 * `bff-web` (HU021 y HU024). Las cuentas son sintéticas, con correos únicos.
 */

const PASSWORD = 'clave-sintetica-e2e-123';
const ATTENDEES = /^\/v1\/me\/events\/[^/]+\/registrations$/;

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
  return `e2e-hu022-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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

const rows = (page: Page) => page.getByTestId('attendees-table').locator('tbody tr');

async function chooseEvent(page: Page, name: string): Promise<void> {
  await page.getByTestId('attendees-event-select').click();
  await page.getByRole('option', { name: new RegExp(name) }).click();
}

test.describe('HU022 Consultar inscritos contra el BFF web @integrado', () => {
  test('CA1, CA2 y CA3: el organizador ve la inscripción real de HU041 con nombre y conteos', async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const suffix = Math.random().toString(36).slice(2, 8);
    const organizerEmail = uniqueEmail('organizador');
    const athleteEmail = uniqueEmail('deportista');
    const athleteName = `Deportista Sintética ${suffix}`;
    const eventName = `Carrera inscritos ${suffix}`;
    const draftName = `Borrador sin inscritos ${suffix}`;

    const page = await newPage(browser);
    const athlete = await newPage(browser);
    await register(page, organizerEmail, 'Organizador de eventos', 'Organizadora Sintética E2E');
    await register(athlete, athleteEmail, 'Deportista', athleteName);

    const organizer = await apiSession(await bffWebUrl(), organizerEmail);
    const eventId = await createEvent(organizer, eventName, true);
    const draftId = await createEvent(organizer, draftName, false);
    await registerAthlete(athleteEmail, eventId);

    await login(page, organizerEmail);
    await page.locator('mat-sidenav [data-menu-item="event-attendees"]').click();
    await expect(page).toHaveURL(/\/organizador\/eventos\/inscritos$/);

    // CA1 y CA5: la inscripción aparece cuando la proyección de Eventos la aplica.
    await expect(async () => {
      await page.goto(`/organizador/eventos/inscritos/${eventId}`);
      await expect(rows(page)).toHaveCount(1, { timeout: 3_000 });
    }, 'la inscripción debía quedar proyectada en event_registration_read').toPass({
      timeout: 60_000,
    });
    await expect(rows(page).first()).toContainText(athleteName);
    await expect(rows(page).first()).toContainText('Inscrito');
    await expect(page.getByTestId('attendees-count-REGISTERED')).toHaveText('1');
    await expect(page.getByTestId('attendees-total')).toHaveText('1');
    await expect(page.getByTestId('attendees-detail')).not.toContainText(athleteEmail);

    // CA3: el borrador no tiene inscritos.
    await chooseEvent(page, draftName);
    await expect(page).toHaveURL(new RegExp(`/organizador/eventos/inscritos/${draftId}$`));
    await expect(page.getByTestId('attendees-empty')).toHaveText(
      'Este evento aún no tiene inscritos.',
    );
    await expect(page.getByTestId('attendees-total')).toHaveText('0');

    // CA2: otro organizador recibe 404 sin datos.
    const outsiderEmail = uniqueEmail('otro-organizador');
    const outsider = await newPage(browser);
    await register(outsider, outsiderEmail, 'Organizador de eventos', 'Otro Organizador E2E');
    await login(outsider, outsiderEmail);
    const notFound = outsider.waitForResponse((r) => ATTENDEES.test(new URL(r.url()).pathname));
    await outsider.goto(`/organizador/eventos/inscritos/${eventId}`);
    await expectStatus(await notFound, 404, 'GET /v1/me/events/{id}/registrations (ajeno)');
    await expect(outsider.getByTestId('attendees-not-found')).toBeVisible();
    await expect(outsider.getByTestId('attendees-detail')).not.toContainText(athleteName);
    await organizer.api.dispose();
  });
});
