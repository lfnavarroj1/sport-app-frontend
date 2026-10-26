import { randomUUID } from 'node:crypto';

import { APIResponse, Browser, Page, Response, expect, request, test } from '@playwright/test';

/**
 * HU012 de punta a punta: Angular → BFF web → training-management (lectura
 * proyectada `health_report_view`), contra el ambiente de `PLAYWRIGHT_BASE_URL`.
 * Requiere `bff-web` 0.33.0 o una versión compatible posterior, el plan `FREE`
 * activo del deportista, el proyector de Usuarios y el publicador y el proyector
 * de Entrenamientos.
 *
 * Los reportes nacen en HU042, cuyo único productor publicado es `bff-mobile`
 * (`POST /v1/me/health-reports`). La preparación registra los reportes del
 * deportista sintético en `PLAYWRIGHT_BFF_MOBILE_URL`, como lo haría la app móvil
 * (mismo criterio que HU011 y HU013), con la versión de consentimiento que
 * publica el `app-config.json` del ambiente. La aplicación web solo llama al BFF
 * web. Datos de salud sintéticos.
 */

const PASSWORD = 'clave-sintetica-e2e-123';
const HOUR_MS = 60 * 60 * 1000;

/** Campos que ADR-037 expone de cada reporte (CA2). */
const ADR_037_FIELDS = [
  'body_area',
  'expected_recovery_days',
  'occurred_at',
  'report_id',
  'session_id',
  'severity',
  'status',
  'type',
];

interface SeededReport {
  readonly reportId: string;
  readonly type: 'DISCOMFORT' | 'INJURY' | 'INCAPACITY';
  readonly occurredAt: string;
}

function bffMobileUrl(): string {
  const url = process.env['PLAYWRIGHT_BFF_MOBILE_URL'];
  if (!url) {
    throw new Error(
      'PLAYWRIGHT_BFF_MOBILE_URL es obligatoria para producir los reportes de HU042.',
    );
  }
  return url;
}

function uniqueEmail(role: string): string {
  return `e2e-hu012-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

/** Instante UTC con sufijo `Z` y precisión de segundos (ADR-037). */
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

/** Comprueba el estado HTTP; si no coincide, deja la operación, el `code` y la correlación. */
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
 * emite el documento nuevo. Así no se captura una respuesta del documento anterior
 * ni se aborta una renovación de sesión en curso (lección de HU011).
 */
async function navigateFor(
  page: Page,
  method: string,
  path: RegExp,
  url?: string,
): Promise<Response> {
  if (url) {
    await page.goto(url, { waitUntil: 'commit' });
  } else {
    await page.reload({ waitUntil: 'commit' });
  }
  const response = await waitForOperation(page, method, path);
  await response.finished();
  return response;
}

const OWN_REPORTS = /^\/v1\/me\/health-reports$/;
const ATHLETE_REPORTS = /^\/v1\/athletes\/[^/]+\/health-reports$/;
const TRAINING_ATHLETES = /^\/v1\/me\/training-athletes$/;

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
      const response = await navigateFor(page, 'GET', /^\/v1\/me\/capabilities$/);
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

/** Versión de consentimiento de datos de salud que publica el ambiente (ADR-034). */
async function consentVersion(page: Page): Promise<string> {
  const response = await page.request.get('/app-config.json');
  await expectStatus(response, 200, 'GET /app-config.json');
  const version = ((await response.json()) as { healthDataConsentVersion?: string | null })
    .healthDataConsentVersion;
  if (!version) {
    throw new Error('El ambiente no publica healthDataConsentVersion en app-config.json.');
  }
  return version;
}

/**
 * Registra tres reportes con HU042 en `bff-mobile`, en las últimas horas, como lo
 * haría la app móvil. Devuelve los reportes en el orden del contrato
 * (`occurred_at` descendente).
 */
async function seedReports(email: string, consent: string): Promise<SeededReport[]> {
  const api = await request.newContext({ baseURL: bffMobileUrl() });
  try {
    const session = await api.post('/v1/sessions', { data: { email, password: PASSWORD } });
    await expectStatus(session, 200, 'bff-mobile POST /v1/sessions');
    const { access_token: token } = (await session.json()) as { access_token: string };
    const now = Date.now();
    const plan = [
      {
        type: 'DISCOMFORT' as const,
        area: 'KNEE',
        severity: 'LOW',
        at: now - 1 * HOUR_MS,
        days: 2,
      },
      {
        type: 'INJURY' as const,
        area: 'ANKLE_FOOT',
        severity: 'HIGH',
        at: now - 3 * HOUR_MS,
        days: 21,
      },
      {
        type: 'INCAPACITY' as const,
        area: 'BACK',
        severity: 'MODERATE',
        at: now - 5 * HOUR_MS,
        days: null,
      },
    ];
    const seeded: SeededReport[] = [];
    for (const entry of plan) {
      const reportId = randomUUID();
      const occurredAt = utcSeconds(entry.at);
      const created = await api.post('/v1/me/health-reports', {
        headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': randomUUID() },
        data: {
          report_id: reportId,
          type: entry.type,
          body_area: entry.area,
          severity: entry.severity,
          occurred_at: occurredAt,
          expected_recovery_days: entry.days,
          consent: { version: consent },
        },
      });
      await expectStatus(created, 201, 'bff-mobile POST /v1/me/health-reports');
      seeded.push({ reportId, type: entry.type, occurredAt });
    }
    return seeded;
  } finally {
    await api.dispose();
  }
}

const rows = (page: Page) => page.getByTestId('health-table').locator('tbody tr');

async function shownReports(page: Page): Promise<(string | null)[]> {
  return rows(page).evaluateAll((items) => items.map((item) => item.getAttribute('data-report')));
}

/** La proyección es eventual: recarga hasta ver los reportes producidos. */
async function waitForProjectedReports(page: Page, path: RegExp, count: number): Promise<void> {
  await expect(async () => {
    const response = await navigateFor(page, 'GET', path);
    await expectStatus(response, 200, 'GET historial de salud');
    await expect(rows(page)).toHaveCount(count, { timeout: 2_000 });
  }, 'los reportes de HU042 debían quedar proyectados (outbox → Pub/Sub → proyector)').toPass({
    timeout: 90_000,
  });
}

test.describe('HU012 Ver historial de molestias o lesiones contra el BFF web @integrado', () => {
  test('CA4: el deportista sin reportes recibe un vacío explícito', async ({ page }) => {
    test.setTimeout(120_000);
    const email = uniqueEmail('deportista');
    await register(page, email, 'Deportista');
    await login(page, email, /\/deportista\/inicio$/);

    const response = waitForOperation(page, 'GET', OWN_REPORTS);
    await page.locator('mat-sidenav [data-menu-item="athlete-health"]').click();
    const reports = await response;
    await expectStatus(reports, 200, 'GET /v1/me/health-reports');
    expect(await reports.json()).toEqual({ items: [], next_cursor: null });

    await expect(page).toHaveURL(/\/deportista\/salud$/);
    await expect(page.getByTestId('state-empty')).toHaveText(
      'Aún no tienes reportes de molestias, incapacidades o lesiones.',
    );
    await expect(page.getByRole('note')).toContainText('no constituyen un diagnóstico médico');

    // CA3: el deportista no entra al área del profesional.
    await page.goto(`/profesional/historial/salud/${randomUUID()}`);
    await expect(page).toHaveURL(/\/acceso-no-autorizado$/);
  });

  test('CA1–CA3 y CA6: reportes de HU042 visibles para el deportista y el profesional autorizado; un tercero recibe 403', async ({
    browser,
  }) => {
    test.setTimeout(360_000);
    const athleteEmail = uniqueEmail('deportista');
    const professionalEmail = uniqueEmail('profesional');
    const outsiderEmail = uniqueEmail('otro-profesional');
    const athlete = await newPage(browser);
    const professional = await newPage(browser);
    const outsider = await newPage(browser);
    await register(professional, professionalEmail, 'Profesional de servicios');
    await register(outsider, outsiderEmail, 'Profesional de servicios');
    await register(athlete, athleteEmail, 'Deportista');

    await login(athlete, athleteEmail, /\/deportista\/inicio$/);
    await waitForFreePlan(athlete);
    await authorize(athlete, professionalEmail);
    const seeded = await seedReports(athleteEmail, await consentVersion(athlete));
    const seededIds = seeded.map((report) => report.reportId);

    // CA1: el deportista ve sus reportes, más reciente primero, con textos del catálogo.
    await athlete.goto('/deportista/salud');
    await waitForProjectedReports(athlete, OWN_REPORTS, seeded.length);
    expect(await shownReports(athlete)).toEqual(seededIds);
    await expect(rows(athlete).nth(0)).toContainText('Molestia');
    await expect(rows(athlete).nth(1)).toContainText('Tobillo o pie');
    await expect(rows(athlete).nth(1)).toContainText('21 días');
    await expect(rows(athlete).nth(2)).toContainText('Sin estimación');

    // CA1: filtro por tipo, consultado al BFF.
    await athlete.getByLabel('Tipo').click();
    await athlete.getByRole('option', { name: 'Lesión', exact: true }).click();
    const filtered = waitForOperation(athlete, 'GET', OWN_REPORTS);
    await athlete.getByRole('button', { name: 'Aplicar filtros' }).click();
    const filteredResponse = await filtered;
    await expectStatus(filteredResponse, 200, 'GET /v1/me/health-reports?type=INJURY');
    expect(new URL(filteredResponse.url()).searchParams.get('type')).toBe('INJURY');
    expect(await shownReports(athlete)).toEqual([seeded[1].reportId]);

    // CA6: un periodo invertido lo rechaza el BFF con 422 y se explica sin datos.
    await athlete.getByRole('button', { name: 'Limpiar' }).click();
    await expect(rows(athlete)).toHaveCount(seeded.length);
    await athlete.getByLabel('Ocurridos desde').fill('2026-10-24');
    await athlete.getByLabel('Ocurridos hasta').fill('2026-10-01');
    const invalid = waitForOperation(athlete, 'GET', OWN_REPORTS);
    await athlete.getByRole('button', { name: 'Aplicar filtros' }).click();
    await expectStatus(await invalid, 422, 'GET /v1/me/health-reports (periodo invertido)');
    await expect(athlete.getByTestId('health-own-error')).toContainText(
      'El periodo o los filtros no son válidos',
    );

    // CA2: el profesional autorizado elige al deportista de su lista y ve los mismos reportes.
    await login(professional, professionalEmail, /\/profesional\/inicio$/);
    await professional.locator('mat-sidenav [data-menu-item="health-history"]').click();
    await expect(professional).toHaveURL(/\/profesional\/historial\/salud$/);
    const athleteItem = professional
      .getByTestId('health-athletes-list')
      .getByRole('listitem')
      .filter({ hasText: athleteEmail });
    await expect(async () => {
      const response = await navigateFor(professional, 'GET', TRAINING_ATHLETES);
      await expectStatus(response, 200, 'GET /v1/me/training-athletes');
      await expect(athleteItem).toHaveCount(1, { timeout: 2_000 });
    }, 'la autorización de HU010 debía quedar proyectada').toPass({ timeout: 60_000 });
    const athleteId = await athleteItem.getAttribute('data-athlete');
    expect(athleteId).toBeTruthy();

    const assigned = waitForOperation(professional, 'GET', ATHLETE_REPORTS);
    await athleteItem.getByRole('link').click();
    await expect(professional).toHaveURL(new RegExp(`/profesional/historial/salud/${athleteId}$`));
    const assignedResponse = await assigned;
    await expectStatus(assignedResponse, 200, 'GET /v1/athletes/{athlete_id}/health-reports');
    const body = (await assignedResponse.json()) as { items: Record<string, unknown>[] };
    for (const item of body.items) {
      expect(Object.keys(item).sort()).toEqual(ADR_037_FIELDS);
    }
    await expect(rows(professional)).toHaveCount(seeded.length);
    expect(await shownReports(professional)).toEqual(seededIds);

    // CA3: otro profesional sin autorización recibe 403 sin datos.
    await login(outsider, outsiderEmail, /\/profesional\/inicio$/);
    const rejected = await navigateFor(
      outsider,
      'GET',
      ATHLETE_REPORTS,
      `/profesional/historial/salud/${athleteId}`,
    );
    await expectStatus(rejected, 403, 'GET /v1/athletes/{athlete_id}/health-reports (tercero)');
    expect((await errorOf(rejected)).code).toBe('athlete_authorization_required');
    await expect(outsider.getByTestId('health-own-error')).toContainText(
      'no te ha autorizado o revocó la autorización',
    );
    await expect(outsider.getByTestId('health-table')).toHaveCount(0);
  });
});
