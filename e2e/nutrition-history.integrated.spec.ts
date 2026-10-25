import { randomUUID } from 'node:crypto';

import { APIResponse, Browser, Page, Response, expect, request, test } from '@playwright/test';

/**
 * HU013 de punta a punta: Angular → BFF web → training-management (lectura
 * proyectada `food_intake_view`), contra el ambiente de `PLAYWRIGHT_BASE_URL`.
 * Requiere `bff-web` 0.32.0 o una versión compatible posterior, el plan `FREE`
 * activo del deportista, el proyector de Usuarios y el publicador y el proyector
 * de Entrenamientos.
 *
 * Los consumos nacen en HU043, cuyo único productor publicado es `bff-mobile`
 * (`POST /v1/me/food-intakes`). La preparación registra los consumos del
 * deportista sintético en `PLAYWRIGHT_BFF_MOBILE_URL`, como lo haría la app móvil
 * (mismo criterio que HU011). La aplicación web solo llama al BFF web.
 */

const PASSWORD = 'clave-sintetica-e2e-123';
const MINUTE_MS = 60 * 1000;

interface SeededIntake {
  readonly intakeId: string;
  readonly mealType: 'BREAKFAST' | 'LUNCH' | 'HYDRATION';
  readonly consumedAt: string;
}

function bffMobileUrl(): string {
  const url = process.env['PLAYWRIGHT_BFF_MOBILE_URL'];
  if (!url) {
    throw new Error(
      'PLAYWRIGHT_BFF_MOBILE_URL es obligatoria para producir los consumos de HU043.',
    );
  }
  return url;
}

function uniqueEmail(role: string): string {
  return `e2e-hu013-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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

const OWN_INTAKES = /^\/v1\/me\/food-intakes$/;
const ATHLETE_INTAKES = /^\/v1\/athletes\/[^/]+\/food-intakes$/;
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

/**
 * Registra tres consumos con HU043 en `bff-mobile`, en los últimos minutos, como
 * lo haría la app móvil. Devuelve los consumos en el orden del contrato
 * (`consumed_at` descendente).
 */
async function seedIntakes(email: string): Promise<SeededIntake[]> {
  const api = await request.newContext({ baseURL: bffMobileUrl() });
  try {
    const session = await api.post('/v1/sessions', { data: { email, password: PASSWORD } });
    await expectStatus(session, 200, 'bff-mobile POST /v1/sessions');
    const { access_token: token } = (await session.json()) as { access_token: string };
    const now = Date.now();
    const plan = [
      {
        mealType: 'HYDRATION' as const,
        at: now - 10 * MINUTE_MS,
        items: [{ food_code: 'WATER', quantity: '500', unit: 'ML' }],
      },
      {
        mealType: 'LUNCH' as const,
        at: now - 40 * MINUTE_MS,
        items: [{ food_code: 'CHICKEN_BREAST', quantity: '150', unit: 'G' }],
      },
      {
        mealType: 'BREAKFAST' as const,
        at: now - 70 * MINUTE_MS,
        items: [
          { food_code: 'OATS', quantity: '60', unit: 'G' },
          { food_code: 'PEANUT_BUTTER', quantity: '1.5', unit: 'TBSP' },
        ],
      },
    ];
    const seeded: SeededIntake[] = [];
    for (const entry of plan) {
      const intakeId = randomUUID();
      const consumedAt = utcSeconds(entry.at);
      const created = await api.post('/v1/me/food-intakes', {
        headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': randomUUID() },
        data: {
          intake_id: intakeId,
          consumed_at: consumedAt,
          meal_type: entry.mealType,
          items: entry.items,
        },
      });
      await expectStatus(created, 201, 'bff-mobile POST /v1/me/food-intakes');
      seeded.push({ intakeId, mealType: entry.mealType, consumedAt });
    }
    return seeded;
  } finally {
    await api.dispose();
  }
}

const entries = (page: Page) => page.getByTestId('food-intakes-list').locator('[data-intake]');

async function shownIntakes(page: Page): Promise<(string | null)[]> {
  return entries(page).evaluateAll((items) =>
    items.map((item) => item.getAttribute('data-intake')),
  );
}

/** La proyección es eventual: recarga hasta ver los consumos producidos. */
async function waitForProjectedIntakes(page: Page, path: RegExp, count: number): Promise<void> {
  await expect(async () => {
    const response = await navigateFor(page, 'GET', path);
    await expectStatus(response, 200, 'GET historial de alimentación');
    await expect(entries(page)).toHaveCount(count, { timeout: 2_000 });
  }, 'los consumos de HU043 debían quedar proyectados (outbox → Pub/Sub → proyector)').toPass({
    timeout: 90_000,
  });
}

test.describe('HU013 Ver historial de alimentación contra el BFF web @integrado', () => {
  test('CA5: el deportista sin consumos ni planes recibe un vacío explícito', async ({ page }) => {
    test.setTimeout(120_000);
    const email = uniqueEmail('deportista');
    await register(page, email, 'Deportista');
    await login(page, email, /\/deportista\/inicio$/);

    const response = waitForOperation(page, 'GET', OWN_INTAKES);
    await page.locator('mat-sidenav [data-menu-item="athlete-nutrition"]').click();
    const intakes = await response;
    await expectStatus(intakes, 200, 'GET /v1/me/food-intakes');
    expect(await intakes.json()).toEqual({ items: [], next_cursor: null });

    await expect(page).toHaveURL(/\/deportista\/alimentacion$/);
    await expect(page.getByTestId('athlete-nutrition-nothing-yet')).toBeVisible();
    await expect(page.getByTestId('food-intakes').getByTestId('state-empty')).toHaveText(
      'Aún no tienes consumos registrados. Regístralos desde la app móvil.',
    );

    // CA3: el deportista no entra al área del profesional.
    await page.goto(`/profesional/historial/alimentacion/${randomUUID()}`);
    await expect(page).toHaveURL(/\/acceso-no-autorizado$/);
  });

  test('CA1 y CA3: consumos de HU043 visibles para el deportista y el profesional autorizado; un tercero recibe 403', async ({
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
    const seeded = await seedIntakes(athleteEmail);
    const seededIds = seeded.map((intake) => intake.intakeId);

    // CA1: el deportista ve sus consumos, más reciente primero, con nombres del catálogo.
    await athlete.goto('/deportista/alimentacion');
    await waitForProjectedIntakes(athlete, OWN_INTAKES, seeded.length);
    expect(await shownIntakes(athlete)).toEqual(seededIds);
    const list = athlete.getByTestId('food-intakes-list');
    await expect(list).toContainText('Agua');
    await expect(list).toContainText('Pechuga de pollo');
    await expect(list).toContainText('1,5 cda.');
    await expect(athlete.locator('main')).not.toContainText(/calor|kcal/i);

    // CA1: filtro por tipo de comida, consultado al BFF.
    await athlete.getByRole('combobox', { name: 'Tipo de comida' }).click();
    await athlete.getByRole('option', { name: 'Almuerzo', exact: true }).click();
    const filtered = waitForOperation(athlete, 'GET', OWN_INTAKES);
    await athlete.getByRole('button', { name: 'Aplicar filtros' }).click();
    const filteredResponse = await filtered;
    await expectStatus(filteredResponse, 200, 'GET /v1/me/food-intakes?meal_type=LUNCH');
    expect(new URL(filteredResponse.url()).searchParams.get('meal_type')).toBe('LUNCH');
    await expect(entries(athlete)).toHaveCount(1);
    expect(await shownIntakes(athlete)).toEqual([seeded[1].intakeId]);

    // CA2: un periodo invertido no se envía y se marca junto a «Hasta».
    await athlete.getByLabel('Desde').fill('2026-10-24');
    await athlete.getByLabel('Hasta').fill('2026-10-01');
    await athlete.getByRole('button', { name: 'Aplicar filtros' }).click();
    await expect(athlete.getByTestId('food-intakes-period-error')).toBeVisible();

    // El profesional autorizado elige al deportista de su lista y ve los mismos consumos.
    await login(professional, professionalEmail, /\/profesional\/inicio$/);
    await professional.locator('mat-sidenav [data-menu-item="nutrition-history"]').click();
    await expect(professional).toHaveURL(/\/profesional\/historial\/alimentacion$/);
    const athleteItem = professional
      .getByTestId('nutrition-athletes-list')
      .getByRole('listitem')
      .filter({ hasText: athleteEmail });
    await expect(async () => {
      const response = await navigateFor(professional, 'GET', TRAINING_ATHLETES);
      await expectStatus(response, 200, 'GET /v1/me/training-athletes');
      await expect(athleteItem).toHaveCount(1, { timeout: 2_000 });
    }, 'la autorización de HU010 debía quedar proyectada').toPass({ timeout: 60_000 });
    const athleteId = await athleteItem.getAttribute('data-athlete');
    expect(athleteId).toBeTruthy();

    const own = waitForOperation(professional, 'GET', ATHLETE_INTAKES);
    await athleteItem.getByRole('link').click();
    await expect(professional).toHaveURL(
      new RegExp(`/profesional/historial/alimentacion/${athleteId}$`),
    );
    await expectStatus(await own, 200, 'GET /v1/athletes/{athlete_id}/food-intakes');
    await expect(entries(professional)).toHaveCount(seeded.length);
    expect(await shownIntakes(professional)).toEqual(seededIds);

    // CA3: otro profesional sin autorización recibe 403 sin datos.
    await login(outsider, outsiderEmail, /\/profesional\/inicio$/);
    const rejected = await navigateFor(
      outsider,
      'GET',
      ATHLETE_INTAKES,
      `/profesional/historial/alimentacion/${athleteId}`,
    );
    await expectStatus(rejected, 403, 'GET /v1/athletes/{athlete_id}/food-intakes (tercero)');
    expect((await errorOf(rejected)).code).toBe('athlete_authorization_required');
    await expect(outsider.getByTestId('food-intakes-not-authorized')).toBeVisible();
    await expect(outsider.getByTestId('food-intakes-list')).toHaveCount(0);
  });
});
