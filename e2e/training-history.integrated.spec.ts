import { randomUUID } from 'node:crypto';

import { APIResponse, Browser, Page, Response, expect, request, test } from '@playwright/test';

/**
 * HU011 de punta a punta: Angular → BFF web → training-management (lectura
 * proyectada), contra el ambiente de `PLAYWRIGHT_BASE_URL`. Requiere `bff-web`
 * 0.8.0 o una versión compatible posterior (0.15.0 para la lista de deportistas
 * autorizados de CA5, que también usa la proyección de nombres de Usuarios), el
 * plan `FREE` activo del deportista,
 * el proyector de Usuarios y el publicador y el proyector de Entrenamientos.
 *
 * Las sesiones terminadas nacen en HU032, cuyo único productor publicado es
 * `bff-mobile` (`POST /v1/training-sessions` y `…/{session_id}/finish`). Para CA1
 * y CA4, la preparación de la prueba registra las sesiones del deportista sintético
 * en `PLAYWRIGHT_BFF_MOBILE_URL`, como lo haría la app móvil (autorización del
 * responsable del 2026-10-18). La aplicación web solo llama al BFF web.
 */

const PASSWORD = 'clave-sintetica-e2e-123';
/** Más sesiones que el tamaño de página por defecto del contrato (20). */
const SEEDED_SESSIONS = 25;
const PAGE_SIZE = 20;
const SPORTS = ['running', 'cycling', 'swimming'] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

type Sport = (typeof SPORTS)[number];

interface SeededSession {
  readonly sessionId: string;
  readonly sport: Sport;
  readonly endedAt: string;
  readonly planId: string | null;
}

interface HistoryPage {
  readonly items: readonly { session_id: string; sport: string; ended_at: string }[];
  readonly next_cursor: string | null;
  readonly filters: { readonly sports: readonly string[] };
}

/**
 * URL pública de `bff-mobile`, solo para producir las sesiones de HU032. Sin ella
 * el recorrido de CA1 y CA4 falla en lugar de simular datos.
 */
function bffMobileUrl(): string {
  const url = process.env['PLAYWRIGHT_BFF_MOBILE_URL'];
  if (!url) {
    throw new Error(
      'PLAYWRIGHT_BFF_MOBILE_URL es obligatoria para producir las sesiones terminadas de HU032.',
    );
  }
  return url;
}

function uniqueEmail(role: string): string {
  return `e2e-hu011-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

/** Instante UTC con sufijo `Z` y precisión de segundos (ADR-029). */
function utcSeconds(time: number): string {
  return new Date(time).toISOString().slice(0, 19) + 'Z';
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

/**
 * Comprueba el estado HTTP. Si no coincide, el mensaje deja la evidencia de la
 * dependencia que falló: operación, estado, `code` y `correlation_id`.
 */
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
 * emite el documento nuevo, con su cuerpo ya leído. Esperarla desde antes de navegar
 * podría capturar una respuesta del documento anterior, cuyo cuerpo se descarta.
 * Cada llamada termina antes de la siguiente navegación, así que tampoco aborta una
 * renovación de sesión en curso (perdería la cookie rotada).
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

const HISTORY_PATH = /^\/v1\/(training-history|athletes\/[^/]+\/training-history)$/;

/** Cada actor usa su propio contexto: su cookie de sesión no se mezcla. */
async function newPage(browser: Browser): Promise<Page> {
  return (await browser.newContext()).newPage();
}

async function register(
  page: Page,
  email: string,
  actorLabel: string,
  fullName = 'Persona Sintética E2E',
): Promise<void> {
  await page.goto('/registro');
  await page.getByLabel('Nombre completo').fill(fullName);
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

/** Espera a que el plan `FREE` quede `ACTIVE` (ADR-024): aparece la opción de planes. */
async function waitForFreePlan(page: Page): Promise<void> {
  const option = page.locator('mat-sidenav [data-menu-item="athlete-training-plans"]');
  await expect(async () => {
    if (!(await option.isVisible())) {
      const { response } = await navigateFor(page, 'GET', /^\/v1\/me\/capabilities$/);
      await expectStatus(response, 200, 'GET /v1/me/capabilities');
    }
    await expect(option).toBeVisible({ timeout: 2_000 });
  }, 'el deportista debía recibir las capacidades del plan FREE (ACTIVE)').toPass({
    timeout: 60_000,
  });
}

/** El deportista autoriza al profesional por correo (HU010). */
async function authorize(page: Page, professional: string): Promise<void> {
  await page.locator('mat-sidenav [data-menu-item="athlete-training-plans"]').click();
  await page.getByLabel('Correo del profesional').fill(professional);
  const granted = waitForOperation(page, 'POST', /^\/v1\/me\/training-authorizations$/);
  await page.getByRole('button', { name: 'Autorizar', exact: true }).click();
  await expectStatus(await granted, 201, 'POST /v1/me/training-authorizations');
  await expect(page.getByTestId('authorization-notice')).toContainText(professional);
}

/** El profesional asigna un plan de carrera (HU010) y queda en su resultado. */
async function assignPlan(
  page: Page,
  athleteEmail: string,
): Promise<{ planId: string; athleteId: string }> {
  await page.locator('mat-sidenav [data-menu-item="training-plans"]').click();
  await page.getByLabel('Correo del deportista').fill(athleteEmail);
  await page.getByLabel('Título').fill('Plan sintético E2E');
  await page.getByRole('textbox', { name: 'Objetivo 1' }).fill('Mejorar la resistencia');
  await page.getByLabel('Fecha de inicio').fill('2026-11-02');
  await page.getByLabel('Fecha de fin').fill('2026-11-29');
  await page.getByLabel('Fecha', { exact: true }).fill('2026-11-03');
  await page.getByLabel('Deporte').click();
  await page.getByRole('option', { name: 'Carrera' }).click();
  await page.getByLabel('Duración (min)').fill('45');
  await page.getByLabel('Intensidad (RPE)').fill('4');
  await page.getByRole('button', { name: 'Revisar plan' }).click();
  const created = waitForOperation(page, 'POST', /^\/v1\/training-plans$/);
  await page.getByRole('button', { name: 'Confirmar y asignar' }).click();
  const response = await created;
  await expectStatus(response, 201, 'POST /v1/training-plans');
  await expect(page.getByTestId('plan-created')).toBeVisible();
  const plan = (await response.json()) as { plan_id: string; athlete_id: string };
  return { planId: plan.plan_id, athleteId: plan.athlete_id };
}

/**
 * Produce sesiones terminadas con HU032 en `bff-mobile`, una tras otra (solo puede
 * haber una activa), en los últimos días y dentro de la antigüedad máxima de 30
 * días. La más reciente pertenece al plan asignado. Devuelve las sesiones en el
 * orden que fija el contrato: `ended_at` descendente.
 */
async function seedFinishedSessions(email: string, planId: string): Promise<SeededSession[]> {
  const api = await request.newContext({ baseURL: bffMobileUrl() });
  try {
    const login = await api.post('/v1/sessions', { data: { email, password: PASSWORD } });
    await expectStatus(login, 200, 'bff-mobile POST /v1/sessions');
    const { access_token: token } = (await login.json()) as { access_token: string };
    const headers = (key: string) => ({ Authorization: `Bearer ${token}`, 'Idempotency-Key': key });

    const now = Date.now();
    const seeded: SeededSession[] = [];
    for (let index = 0; index < SEEDED_SESSIONS; index++) {
      const sport: Sport = index === 0 ? 'running' : SPORTS[index % SPORTS.length];
      const planOfSession = index === 0 ? planId : null;
      const ended = now - (index + 1) * DAY_MS + 7 * 60 * 60 * 1000;
      const sessionId = randomUUID();
      const started = await api.post('/v1/training-sessions', {
        headers: headers(randomUUID()),
        data: {
          session_id: sessionId,
          sport,
          started_at: utcSeconds(ended - (30 + index) * 60 * 1000),
          ...(planOfSession ? { plan_id: planOfSession } : {}),
        },
      });
      await expectStatus(started, 201, 'bff-mobile POST /v1/training-sessions');
      const finished = await api.post(`/v1/training-sessions/${sessionId}/finish`, {
        headers: headers(randomUUID()),
        data: { ended_at: utcSeconds(ended) },
      });
      await expectStatus(finished, 200, 'bff-mobile POST /v1/training-sessions/{id}/finish');
      seeded.push({ sessionId, sport, endedAt: utcSeconds(ended), planId: planOfSession });
    }
    return seeded;
  } finally {
    await api.dispose();
  }
}

const rows = (page: Page) => page.getByTestId('history-table').locator('tbody tr');

async function shownSessions(page: Page): Promise<(string | null)[]> {
  return rows(page).evaluateAll((items) => items.map((item) => item.getAttribute('data-session')));
}

/** La proyección es eventual: recarga hasta ver todas las sesiones producidas. */
async function waitForProjectedHistory(page: Page): Promise<void> {
  await expect(async () => {
    const { response: first } = await navigateFor(page, 'GET', HISTORY_PATH);
    await expectStatus(first, 200, 'GET historial');
    await expect(rows(page)).toHaveCount(PAGE_SIZE, { timeout: 2_000 });
    const second = waitForOperation(page, 'GET', HISTORY_PATH);
    await page.getByRole('button', { name: 'Cargar más' }).click({ timeout: 2_000 });
    await expectStatus(await second, 200, 'GET historial (página 2)');
    await expect(rows(page)).toHaveCount(SEEDED_SESSIONS, { timeout: 2_000 });
  }, 'las sesiones de HU032 debían quedar proyectadas (outbox → Pub/Sub → proyector)').toPass({
    timeout: 90_000,
  });
}

test.describe('HU011 Ver historial de entrenamiento contra el BFF web @integrado', () => {
  test('CA2: el deportista sin sesiones terminadas recibe la colección vacía con los filtros', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const email = uniqueEmail('deportista');
    await register(page, email, 'Deportista');
    await login(page, email, /\/deportista\/inicio$/);

    const response = waitForOperation(page, 'GET', /^\/v1\/training-history$/);
    await page.locator('mat-sidenav [data-menu-item="athlete-training-history"]').click();
    const history = await response;
    await expectStatus(history, 200, 'GET /v1/training-history');
    const body = (await history.json()) as HistoryPage;
    expect(body.items).toEqual([]);
    expect(body.next_cursor).toBeNull();
    expect(Array.isArray(body.filters.sports)).toBe(true);

    await expect(page).toHaveURL(/\/deportista\/historial\/entrenamientos$/);
    await expect(page.getByTestId('state-empty')).toHaveText(
      'Aún no tienes entrenamientos terminados.',
    );
    await expect(page.getByRole('button', { name: 'Aplicar filtros' })).toBeVisible();
    await expect(page.getByTestId('history-table')).toHaveCount(0);

    // CA3: el deportista no entra al área del profesional.
    await page.goto(`/profesional/historial/entrenamientos/${randomUUID()}`);
    await expect(page).toHaveURL(/\/acceso-no-autorizado$/);
  });

  test('CA1, CA3 y CA4: sesiones de HU032 filtradas y paginadas; acceso del profesional autorizado, de un tercero y tras revocar', async ({
    browser,
  }) => {
    test.setTimeout(360_000);
    const athleteEmail = uniqueEmail('deportista');
    const professionalEmail = uniqueEmail('profesional');
    const outsiderEmail = uniqueEmail('otro-profesional');
    const professional = await newPage(browser);
    const outsider = await newPage(browser);
    const athlete = await newPage(browser);
    await register(professional, professionalEmail, 'Profesional de servicios');
    await register(outsider, outsiderEmail, 'Profesional de servicios');
    await register(athlete, athleteEmail, 'Deportista');

    await login(athlete, athleteEmail, /\/deportista\/inicio$/);
    await waitForFreePlan(athlete);
    await authorize(athlete, professionalEmail);

    await login(professional, professionalEmail, /\/profesional\/inicio$/);
    const { planId, athleteId } = await assignPlan(professional, athleteEmail);

    const seeded = await seedFinishedSessions(athleteEmail, planId);
    const seededIds = seeded.map((session) => session.sessionId);

    // CA4: el deportista recorre su historial real en dos páginas, sin perder ni repetir.
    await athlete.locator('mat-sidenav [data-menu-item="athlete-training-history"]').click();
    await expect(athlete).toHaveURL(/\/deportista\/historial\/entrenamientos$/);
    await waitForProjectedHistory(athlete);

    const { response: first, body: firstPageBody } = await navigateFor<HistoryPage>(
      athlete,
      'GET',
      /^\/v1\/training-history$/,
    );
    await expectStatus(first, 200, 'GET /v1/training-history');
    const firstBody = firstPageBody!;
    expect(firstBody.items).toHaveLength(PAGE_SIZE);
    expect(firstBody.next_cursor).not.toBeNull();
    await expect(rows(athlete)).toHaveCount(PAGE_SIZE);
    await expect(athlete.getByTestId('history-count')).toHaveText(
      `Sesiones mostradas: ${PAGE_SIZE}. Hay más disponibles.`,
    );

    const secondPage = waitForOperation(athlete, 'GET', /^\/v1\/training-history$/);
    await athlete.getByRole('button', { name: 'Cargar más' }).click();
    const second = await secondPage;
    await expectStatus(second, 200, 'GET /v1/training-history (página 2)');
    expect(new URL(second.url()).searchParams.get('cursor')).toBe(firstBody.next_cursor);
    const secondBody = (await second.json()) as HistoryPage;
    expect(secondBody.items).toHaveLength(SEEDED_SESSIONS - PAGE_SIZE);
    expect(secondBody.next_cursor).toBeNull();
    await expect(rows(athlete)).toHaveCount(SEEDED_SESSIONS);
    await expect(athlete.getByRole('button', { name: 'Cargar más' })).toHaveCount(0);
    // CA1: solo las sesiones propias, en el orden del contrato (`ended_at` descendente).
    expect(await shownSessions(athlete)).toEqual(seededIds);
    expect(new Set(await shownSessions(athlete)).size).toBe(SEEDED_SESSIONS);

    // La sesión del plan muestra su detalle; el deportista no tiene vista de planes.
    await rows(athlete).first().getByRole('button', { name: 'Ver detalle' }).click();
    const athleteDetail = athlete.getByTestId('history-detail');
    await expect(athleteDetail).toContainText('Detalle de la sesión');
    await expect(athleteDetail).toContainText('Parte de un plan');

    // CA1: por deporte y periodo (día UTC de fin, inclusivo), sin filtrar en el cliente.
    const from = seeded[12].endedAt.slice(0, 10);
    const to = seeded[3].endedAt.slice(0, 10);
    const expected = seeded
      .filter((s) => s.sport === 'cycling' && s.endedAt.slice(0, 10) >= from)
      .filter((s) => s.endedAt.slice(0, 10) <= to)
      .map((s) => s.sessionId);
    expect(expected.length).toBeGreaterThan(0);
    await athlete.getByLabel('Deporte').click();
    await athlete.getByRole('option', { name: 'Ciclismo' }).click();
    await athlete.getByLabel('Terminadas desde').fill(from);
    await athlete.getByLabel('Terminadas hasta').fill(to);
    const filtered = waitForOperation(athlete, 'GET', /^\/v1\/training-history$/);
    await athlete.getByRole('button', { name: 'Aplicar filtros' }).click();
    const filteredResponse = await filtered;
    await expectStatus(filteredResponse, 200, 'GET /v1/training-history (filtrado)');
    const query = new URL(filteredResponse.url()).searchParams;
    expect([query.get('sport'), query.get('from'), query.get('to')]).toEqual(['cycling', from, to]);
    await expect(rows(athlete)).toHaveCount(expected.length);
    expect(await shownSessions(athlete)).toEqual(expected);
    for (const row of await rows(athlete).all()) {
      await expect(row).toContainText('Ciclismo');
    }

    // CA1 y CA3: el profesional autorizado llega desde el plan y ve el mismo historial.
    await professional.getByRole('link', { name: 'Ver historial de entrenamiento' }).click();
    await expect(professional).toHaveURL(
      new RegExp(`/profesional/historial/entrenamientos/${athleteId}$`),
    );
    await expect(async () => {
      // La autorización también se proyecta: hasta entonces la consulta responde 403.
      const { response } = await navigateFor(professional, 'GET', HISTORY_PATH);
      await expectStatus(response, 200, 'GET /v1/athletes/{athlete_id}/training-history');
      await expect(rows(professional)).toHaveCount(PAGE_SIZE, { timeout: 2_000 });
    }, 'la autorización debía quedar proyectada para el profesional').toPass({ timeout: 60_000 });
    expect(await shownSessions(professional)).toEqual(seededIds.slice(0, PAGE_SIZE));
    await rows(professional).first().getByRole('button', { name: 'Ver detalle' }).click();
    await expect(
      professional.getByTestId('history-detail').getByRole('link', { name: 'Consultar el plan' }),
    ).toHaveAttribute('href', `/profesional/entrenamientos/planes/${planId}`);

    // CA3: un profesional sin relación con el deportista recibe el rechazo, sin datos.
    await login(outsider, outsiderEmail, /\/profesional\/inicio$/);
    const rejected = waitForOperation(outsider, 'GET', HISTORY_PATH);
    await outsider.goto(`/profesional/historial/entrenamientos/${athleteId}`);
    const rejection = await rejected;
    await expectStatus(rejection, 403, 'GET /v1/athletes/{athlete_id}/training-history');
    expect((await errorOf(rejection)).code).toBe('athlete_authorization_required');
    await expect(outsider.getByTestId('history-not-authorized')).toContainText(
      'no te ha autorizado o revocó la autorización',
    );
    await expect(outsider.getByTestId('history-table')).toHaveCount(0);

    // CA3: tras la revocación (proyectada de forma eventual), el profesional ya no consulta.
    await athlete.locator('mat-sidenav [data-menu-item="athlete-training-plans"]').click();
    await athlete.getByLabel('Correo del profesional').fill(professionalEmail);
    const again = waitForOperation(athlete, 'POST', /^\/v1\/me\/training-authorizations$/);
    await athlete.getByRole('button', { name: 'Autorizar', exact: true }).click();
    // Ya activa: el contrato responde 200 y la entrada queda disponible para revocar.
    await expectStatus(await again, 200, 'POST /v1/me/training-authorizations (ya activa)');
    const entry = athlete.locator(`[data-professional="${professionalEmail}"]`);
    await entry.getByRole('button', { name: 'Revocar', exact: true }).click();
    const revoked = waitForOperation(
      athlete,
      'DELETE',
      /^\/v1\/me\/training-authorizations\/[^/]+$/,
    );
    await entry.getByRole('button', { name: 'Revocar autorización' }).click();
    await expectStatus(await revoked, 204, 'DELETE /v1/me/training-authorizations/{id}');
    await expect(entry).toContainText('Autorización revocada');

    await expect(async () => {
      const { response } = await navigateFor(professional, 'GET', HISTORY_PATH);
      await expectStatus(response, 403, 'GET /v1/athletes/{athlete_id}/training-history');
      await expect(professional.getByTestId('history-not-authorized')).toBeVisible({
        timeout: 2_000,
      });
    }, 'la revocación debía quedar proyectada (outbox → proyector)').toPass({ timeout: 60_000 });
    await expect(professional.getByTestId('history-table')).toHaveCount(0);
  });

  test('CA5: el profesional elige por nombre y correo a quien lo autorizó; tras revocar, desaparece de la lista', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const suffix = Math.random().toString(36).slice(2, 8);
    const athleteName = `Deportista Sintética ${suffix}`;
    const athleteEmail = uniqueEmail('deportista');
    const professionalEmail = uniqueEmail('profesional');
    const outsiderEmail = uniqueEmail('otro-profesional');
    const professional = await newPage(browser);
    const outsider = await newPage(browser);
    const athlete = await newPage(browser);
    await register(professional, professionalEmail, 'Profesional de servicios');
    await register(outsider, outsiderEmail, 'Profesional de servicios');
    await register(athlete, athleteEmail, 'Deportista', athleteName);

    await login(athlete, athleteEmail, /\/deportista\/inicio$/);
    await waitForFreePlan(athlete);
    await authorize(athlete, professionalEmail);

    // La lista sale de las autorizaciones proyectadas, enriquecidas por el BFF con
    // nombre y correo de Usuarios; aparece de forma eventual.
    await login(professional, professionalEmail, /\/profesional\/inicio$/);
    await professional.locator('mat-sidenav [data-menu-item="training-history"]').click();
    await expect(professional).toHaveURL(/\/profesional\/historial\/entrenamientos$/);
    const items = professional.getByTestId('training-athletes-list').getByRole('listitem');
    let listed: { items: { athlete_id: string; full_name: string; email: string }[] } = {
      items: [],
    };
    await expect(async () => {
      const { response: athletes, body } = await navigateFor<typeof listed>(
        professional,
        'GET',
        /^\/v1\/me\/training-athletes$/,
      );
      await expectStatus(athletes, 200, 'GET /v1/me/training-athletes');
      listed = body!;
      expect(listed.items.map((item) => item.email)).toContain(athleteEmail);
    }, 'la autorización debía quedar proyectada y enriquecida con nombre y correo').toPass({
      timeout: 60_000,
    });
    // Solo los deportistas que autorizaron a este profesional: aquí, exactamente uno.
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0].full_name).toBe(athleteName);
    await expect(items).toHaveCount(1);
    await expect(items.first()).toContainText(athleteName);
    await expect(items.first()).toContainText(athleteEmail);
    await expect(items.first()).toContainText('Te autorizó el');
    await expect(professional.locator('main input')).toHaveCount(0);

    // Elegirlo abre su historial por la ruta existente; el BFF lo autoriza.
    const history = waitForOperation(professional, 'GET', HISTORY_PATH);
    await items.first().getByRole('link').click();
    await expect(professional).toHaveURL(
      new RegExp(`/profesional/historial/entrenamientos/${listed.items[0].athlete_id}$`),
    );
    await expectStatus(await history, 200, 'GET /v1/athletes/{athlete_id}/training-history');
    await expect(professional.getByTestId('state-empty')).toHaveText(
      'Este deportista aún no tiene entrenamientos terminados.',
    );

    // Otro profesional no ve a ese deportista.
    await login(outsider, outsiderEmail, /\/profesional\/inicio$/);
    const { response: outsiderResponse, body: outsiderBody } = await navigateFor<{
      items: unknown[];
    }>(outsider, 'GET', /^\/v1\/me\/training-athletes$/, '/profesional/historial/entrenamientos');
    await expectStatus(outsiderResponse, 200, 'GET /v1/me/training-athletes (tercero)');
    expect(outsiderBody!.items).toEqual([]);
    await expect(outsider.getByTestId('state-empty')).toContainText(
      'Aún ningún deportista te ha autorizado',
    );

    // Tras la revocación (proyectada de forma eventual), el deportista sale de la lista.
    await athlete.reload();
    await athlete.getByLabel('Correo del profesional').fill(professionalEmail);
    const again = waitForOperation(athlete, 'POST', /^\/v1\/me\/training-authorizations$/);
    await athlete.getByRole('button', { name: 'Autorizar', exact: true }).click();
    await expectStatus(await again, 200, 'POST /v1/me/training-authorizations (ya activa)');
    const entry = athlete.locator(`[data-professional="${professionalEmail}"]`);
    await entry.getByRole('button', { name: 'Revocar', exact: true }).click();
    const revoked = waitForOperation(
      athlete,
      'DELETE',
      /^\/v1\/me\/training-authorizations\/[^/]+$/,
    );
    await entry.getByRole('button', { name: 'Revocar autorización' }).click();
    await expectStatus(await revoked, 204, 'DELETE /v1/me/training-authorizations/{id}');

    await expect(async () => {
      const { response: athletes, body } = await navigateFor<{ items: { email: string }[] }>(
        professional,
        'GET',
        /^\/v1\/me\/training-athletes$/,
        '/profesional/historial/entrenamientos',
      );
      await expectStatus(athletes, 200, 'GET /v1/me/training-athletes');
      expect(body!.items.map((item) => item.email)).not.toContain(athleteEmail);
    }, 'la revocación debía retirar al deportista de la lista').toPass({ timeout: 60_000 });
    await expect(professional.getByTestId('state-empty')).toContainText(
      'Aún ningún deportista te ha autorizado',
    );
  });
});
