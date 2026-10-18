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
 * HU024 de punta a punta: Angular → BFF web → events-management (escritura,
 * outbox y proyección `event_read`), contra el ambiente de `PLAYWRIGHT_BASE_URL`.
 * Requiere `bff-web` 0.16.0, `events-management` con `POST /publish` y el
 * publicador y el proyector de Eventos. Como fija la tarea, el borrador se crea
 * por API con `POST /v1/events` de `bff-web` (HU021); la web solo publica. Las
 * cuentas son sintéticas, con correos únicos por ejecución.
 */

const PASSWORD = 'clave-sintetica-e2e-123';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MY_EVENTS = /^\/v1\/me\/events$/;
const DETAIL = /^\/v1\/events\/[^/]+$/;

function baseUrl(): string {
  const url = process.env['PLAYWRIGHT_BASE_URL'];
  if (!url) {
    throw new Error('PLAYWRIGHT_BASE_URL es obligatoria para la suite integrada.');
  }
  return url.replace(/\/$/, '');
}

function uniqueEmail(role: string): string {
  return `e2e-hu024-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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

/**
 * Navega (a `url` o recargando) y devuelve la primera respuesta de la operación que
 * emite el documento nuevo, con su cuerpo ya leído. Así no se captura una respuesta
 * del documento anterior ni se aborta una renovación de sesión en curso.
 */
async function navigateFor<T>(
  page: Page,
  method: string,
  path: RegExp,
  url?: string,
): Promise<{ response: Response; body: T | null }> {
  if (url) {
    await page.goto(url, { waitUntil: 'commit' });
  } else {
    await page.reload({ waitUntil: 'commit' });
  }
  const response = await waitForOperation(page, method, path);
  try {
    return { response, body: (await response.json()) as T };
  } catch {
    return { response, body: null };
  }
}

async function newPage(browser: Browser): Promise<Page> {
  return (await browser.newContext()).newPage();
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

/**
 * Sesión propia de la API de `bff-web` (contexto aparte: no comparte la cookie
 * de renovación con el navegador). La URL del BFF sale del `app-config.json`
 * que sirve el ambiente.
 */
async function apiSession(email: string): Promise<{ api: APIRequestContext; token: string }> {
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

/** Crea el borrador por API (HU021, ADR-028) y devuelve su `event_id`. */
async function createDraft(
  session: { api: APIRequestContext; token: string },
  name: string,
  startsAtMs: number,
): Promise<string> {
  const created = await session.api.post('/v1/events', {
    headers: { Authorization: `Bearer ${session.token}`, 'Idempotency-Key': randomUUID() },
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
      starts_at: bogotaStartsAt(startsAtMs),
      time_zone: 'America/Bogota',
      duration_minutes: 180,
      capacity: 500,
    },
  });
  await expectStatus(created, 201, 'API POST /v1/events');
  return ((await created.json()) as { event_id: string }).event_id;
}

/** Abre la publicación y espera a que el borrador esté proyectado en la lista. */
async function openDraft(page: Page, eventId: string): Promise<void> {
  await page.locator('mat-sidenav [data-menu-item="event-publish"]').click();
  await expect(page).toHaveURL(/\/organizador\/eventos\/publicacion$/);
  await expect(async () => {
    const { response } = await navigateFor(page, 'GET', MY_EVENTS);
    await expectStatus(response, 200, 'GET /v1/me/events');
    await expect(page.locator(`li[data-event="${eventId}"]`)).toBeVisible({ timeout: 2_000 });
  }, 'el borrador debía quedar proyectado en GET /v1/me/events (outbox → proyector)').toPass({
    timeout: 60_000,
  });
  await page.locator(`li[data-event="${eventId}"] a`).click();
  await expect(page).toHaveURL(new RegExp(`/organizador/eventos/publicacion/${eventId}$`));
}

test.describe('HU024 Publicar eventos contra el BFF web @integrado', () => {
  test('CA1, CA3 y CA6: publica desde la pantalla un borrador creado por API; queda visible en publicados y para otros actores', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const organizerEmail = uniqueEmail('organizador');
    const outsiderEmail = uniqueEmail('otro-organizador');
    const page = await newPage(browser);
    const outsiderPage = await newPage(browser);
    await register(page, organizerEmail);
    await register(outsiderPage, outsiderEmail);
    await login(page, organizerEmail);

    const name = `Carrera E2E ${Math.random().toString(36).slice(2, 8)}`;
    const eventId = await createDraft(
      await apiSession(organizerEmail),
      name,
      Date.now() + 30 * 86_400_000,
    );
    const outsider = await apiSession(outsiderEmail);

    // CA3: el borrador no es visible para otro organizador.
    const hidden = await outsider.api.get(`/v1/events/${eventId}`, {
      headers: { Authorization: `Bearer ${outsider.token}` },
    });
    await expectStatus(hidden, 404, 'GET /v1/events/{event_id} (tercero, borrador)');
    expect((await errorOf(hidden)).code).toBe('event_not_found');

    await openDraft(page, eventId);
    const detail = page.getByTestId('event-publish-detail');
    await expect(detail.getByTestId('event-detail-name')).toHaveText(name);
    await expect(detail.getByTestId('event-detail-status')).toHaveText('Borrador');

    // CA1: publica tras confirmar; la pantalla muestra solo lo confirmado por el backend.
    await detail.getByRole('button', { name: 'Publicar' }).click();
    const published = waitForOperation(page, 'POST', /^\/v1\/events\/[^/]+\/publish$/);
    await detail.getByRole('button', { name: 'Confirmar publicación' }).click();
    const response = await published;
    await expectStatus(response, 200, 'POST /v1/events/{event_id}/publish');
    expect(response.request().postData()).toBeNull();
    expect(await response.request().headerValue('idempotency-key')).toMatch(UUID);
    const body = (await response.json()) as {
      status: string;
      version: number;
      published_at: string | null;
    };
    expect(body.status).toBe('PUBLISHED');
    expect(body.version).toBe(2);
    expect(body.published_at).not.toBeNull();
    await expect(detail.getByTestId('event-published')).toContainText('Evento publicado');
    await expect(detail.getByTestId('event-published-version')).toHaveText('2');

    // Sale de los borradores y aparece entre los publicados.
    await expect(page.locator(`li[data-event="${eventId}"]`)).toHaveCount(0);
    await page.getByTestId('events-tab-published').click();
    await expect(page.locator(`li[data-event="${eventId}"]`)).toBeVisible();

    // CA1 y CA6: una vez proyectado, la consulta del backend lo lista como publicado.
    await expect(async () => {
      const { response: list, body: listed } = await navigateFor<{
        items: { event_id: string; status: string; published_at: string | null }[];
      }>(page, 'GET', MY_EVENTS, '/organizador/eventos/publicacion');
      await expectStatus(list, 200, 'GET /v1/me/events');
      expect(new URL(list.url()).searchParams.get('status')).toBe('DRAFT');
      expect(listed!.items.map((item) => item.event_id)).not.toContain(eventId);
      const publishedList = waitForOperation(page, 'GET', MY_EVENTS);
      await page.getByTestId('events-tab-published').click();
      const projected = await publishedList;
      await expectStatus(projected, 200, 'GET /v1/me/events?status=PUBLISHED');
      const projectedBody = (await projected.json()) as {
        items: { event_id: string; status: string; published_at: string | null }[];
      };
      const item = projectedBody.items.find((event) => event.event_id === eventId);
      expect(item?.status).toBe('PUBLISHED');
      expect(item?.published_at).not.toBeNull();
    }, 'event_read debía reflejar PUBLISHED (evento.publicado.v1 → proyector)').toPass({
      timeout: 60_000,
    });
    await expect(page.locator(`li[data-event="${eventId}"]`)).toBeVisible();
    await expect(page.getByTestId('event-recently-published')).toHaveCount(0);

    // CA1: publicado, es visible para cualquier actor autenticado.
    await expect(async () => {
      const visible = await outsider.api.get(`/v1/events/${eventId}`, {
        headers: { Authorization: `Bearer ${outsider.token}` },
      });
      await expectStatus(visible, 200, 'GET /v1/events/{event_id} (tercero, publicado)');
      expect(((await visible.json()) as { status: string }).status).toBe('PUBLISHED');
    }, 'el evento publicado debía ser visible para otro actor').toPass({ timeout: 60_000 });

    // Al volver a abrirlo, ya no ofrece publicar.
    await page.locator(`li[data-event="${eventId}"] a`).click();
    await expect(detail.getByTestId('event-already-published')).toBeVisible();
    await expect(detail.getByRole('button', { name: 'Publicar' })).toHaveCount(0);
  });

  test('CA2: un borrador cuyo inicio ya pasó no se publica y el requisito aparece junto al campo', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const organizerEmail = uniqueEmail('organizador');
    const page = await newPage(browser);
    await register(page, organizerEmail);
    await login(page, organizerEmail);

    // El borrador se crea con un inicio apenas futuro y se publica cuando ya pasó.
    const startsAt = Date.now() + 75_000;
    const eventId = await createDraft(
      await apiSession(organizerEmail),
      'Carrera E2E pasada',
      startsAt,
    );
    await openDraft(page, eventId);
    const wait = startsAt + 5_000 - Date.now();
    if (wait > 0) {
      await page.waitForTimeout(wait);
    }
    await navigateFor(page, 'GET', DETAIL);

    const detail = page.getByTestId('event-publish-detail');
    await expect(detail.getByTestId('event-starts-in-past')).toBeVisible();
    await detail.getByRole('button', { name: 'Publicar' }).click();
    const rejected = waitForOperation(page, 'POST', /^\/v1\/events\/[^/]+\/publish$/);
    await detail.getByRole('button', { name: 'Confirmar publicación' }).click();
    const response = await rejected;
    await expectStatus(response, 422, 'POST /v1/events/{event_id}/publish');
    const body = (await response.json()) as {
      code: string;
      details: { field: string; issue: string }[];
    };
    expect(body.code).toBe('validation_error');
    expect(body.details).toContainEqual({ field: 'starts_at', issue: 'not_in_future' });

    await expect(detail.getByTestId('event-publish-violations')).toContainText(
      'Fecha y hora de inicio: debe ser una fecha futura.',
    );
    await expect(detail.getByTestId('event-detail-starts-at')).toContainText(
      'debe ser una fecha futura.',
    );
    await expect(detail.getByTestId('event-detail-status')).toHaveText('Borrador');
    await expect(page.locator(`li[data-event="${eventId}"]`)).toBeVisible();
  });
});
