import { Browser, Locator, Page, Response, expect, test } from '@playwright/test';

/**
 * HU014 de punta a punta: Angular → BFF web → users-management (lookup por correo
 * y restricciones alimenticias) → training-management (escritura, outbox y
 * proyección), contra el ambiente de `PLAYWRIGHT_BASE_URL`. Requiere `bff-web`
 * 0.18.0, `training-management` 0.9.0 y `users-management` 0.8.0 desplegados, el
 * plan `FREE` activo del deportista (para autorizar al profesional, HU010), el
 * proyector de lectura de Usuarios y el publicador y el proyector de
 * Entrenamientos. Registra cuentas sintéticas con correos únicos.
 *
 * Sin HU009 ninguna cuenta tiene hábitos alimenticios: el plan se crea con
 * `warnings: ["nutrition_habits_missing"]` (CA6) y el bloqueo real por alergia
 * (CA2) no se puede producir todavía en un ambiente integrado; lo cubren las
 * pruebas de componentes y `nutrition-plans.spec.ts` con el simulador del contrato.
 */

const PASSWORD = 'clave-sintetica-e2e-123';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function uniqueEmail(role: string): string {
  return `e2e-hu014-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

/** Fecha calendario `YYYY-MM-DD` a `days` días de hoy, para que el periodo siga vigente. */
function dayFromToday(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Comprueba el estado HTTP. Si no coincide, el mensaje deja la evidencia de la
 * dependencia que falló: operación, estado, `code` y `correlation_id` del BFF.
 */
async function expectStatus(response: Response, expected: number): Promise<void> {
  if (response.status() === expected) {
    return;
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Sin cuerpo JSON: basta con el estado.
  }
  const error = (body ?? {}) as { code?: string; correlation_id?: string };
  expect(
    response.status(),
    `${response.request().method()} ${new URL(response.url()).pathname} → ${response.status()}` +
      ` code=${error.code ?? '-'} correlation_id=${error.correlation_id ?? '-'}`,
  ).toBe(expected);
}

function waitForOperation(page: Page, method: string, path: RegExp): Promise<Response> {
  return page.waitForResponse(
    (r) => r.request().method() === method && path.test(new URL(r.url()).pathname),
  );
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
  await expectStatus(await created, 201);
  await expect(page.getByRole('status')).toContainText(email);
}

async function login(page: Page, email: string, home: RegExp): Promise<void> {
  await page.goto('/iniciar-sesion');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  const session = waitForOperation(page, 'POST', /^\/v1\/sessions$/);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expectStatus(await session, 200);
  // Navegar antes de llegar al inicio perdería la sesión recién creada.
  await expect(page).toHaveURL(home);
}

/** Cada actor usa su propio contexto: su cookie de sesión no se mezcla. */
async function newPage(browser: Browser): Promise<Page> {
  return (await browser.newContext()).newPage();
}

/**
 * HU010: el deportista recibe `training.plan.manage` de su plan `FREE` (se activa
 * por mensajería, ADR-024) y autoriza al profesional por correo. La misma
 * autorización cubre entrenamiento, salud y alimentación (ADR-037).
 */
async function authorize(page: Page, athlete: string, professional: string): Promise<Page> {
  await register(page, athlete, 'Deportista');
  await login(page, athlete, /\/deportista\/inicio$/);
  const option = page.locator('mat-sidenav [data-menu-item="athlete-training-plans"]');
  await expect(async () => {
    if (!(await option.isVisible())) {
      const capabilities = waitForOperation(page, 'GET', /^\/v1\/me\/capabilities$/);
      await page.reload();
      await expectStatus(await capabilities, 200);
    }
    await expect(option).toBeVisible({ timeout: 2_000 });
  }, 'el deportista debía recibir la capacidad training.plan.manage (plan FREE ACTIVE)').toPass({
    timeout: 60_000,
  });
  await option.click();
  await page.getByLabel('Correo del profesional').fill(professional);
  const granted = waitForOperation(page, 'POST', /^\/v1\/me\/training-authorizations$/);
  await page.getByRole('button', { name: 'Autorizar', exact: true }).click();
  await expectStatus(await granted, 201);
  await expect(page.getByTestId('authorization-notice')).toContainText(professional);
  return page;
}

async function chooseOption(page: Page, field: Locator, name: string): Promise<void> {
  await field.click();
  await page.getByRole('option', { name, exact: true }).click();
}

async function openEditor(page: Page, email: string): Promise<void> {
  await login(page, email, /\/profesional\/inicio$/);
  await page.locator('mat-sidenav [data-menu-item="nutrition-plans"]').click();
  await expect(page).toHaveURL(/\/profesional\/alimentacion\/planes$/);
  // El editor se habilita con el catálogo de `GET /v1/food-catalog`.
  await expect(page.getByRole('button', { name: 'Revisar plan' })).toBeVisible();
}

async function fillPlan(page: Page, athlete: string): Promise<void> {
  const item = page.getByTestId('nutrition-item-0-0');
  await page.getByLabel('Correo del deportista').fill(athlete);
  await page.getByLabel('Título').fill('Plan de alimentación sintético E2E');
  await page.getByRole('textbox', { name: 'Objetivo 1' }).fill('Mejorar la recuperación');
  await page.getByLabel('Fecha de inicio').fill(dayFromToday(7));
  await page.getByLabel('Fecha de fin').fill(dayFromToday(34));
  await chooseOption(page, page.getByRole('combobox', { name: 'Tipo de comida' }), 'Desayuno');
  await chooseOption(page, item.getByRole('combobox', { name: 'Alimento' }), 'Avena');
  await item.getByLabel('Cantidad').fill('60');
  await page.getByRole('button', { name: 'Revisar plan' }).click();
}

/** Confirma la asignación y devuelve la respuesta de `POST /v1/nutrition-plans`. */
async function confirm(page: Page): Promise<Response> {
  const response = waitForOperation(page, 'POST', /^\/v1\/nutrition-plans$/);
  await page.getByRole('button', { name: 'Confirmar y asignar' }).click();
  return response;
}

test.describe('HU014 Crear plan de alimentación contra el BFF web @integrado', () => {
  test('CA1, CA3–CA6: asignar con reintento idempotente y aviso sin hábitos, consultar proyectado y rechazar a un tercero', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const athleteEmail = uniqueEmail('deportista');
    const professionalEmail = uniqueEmail('profesional');
    const outsiderEmail = uniqueEmail('otro-profesional');
    const professional = await newPage(browser);
    const outsider = await newPage(browser);
    await register(professional, professionalEmail, 'Profesional de servicios');
    await register(outsider, outsiderEmail, 'Profesional de servicios');
    const athlete = await authorize(await newPage(browser), athleteEmail, professionalEmail);

    // CA1: la primera respuesta llega al BFF real pero se pierde en la red; el
    // reintento desde la pantalla usa la misma Idempotency-Key y recibe el mismo plan.
    await openEditor(professional, professionalEmail);
    await fillPlan(professional, athleteEmail);
    let lost: { key: string | null; status: number; plan: { plan_id: string } } | null = null;
    await professional.route('**/v1/nutrition-plans', async (route) => {
      const original = await route.fetch();
      lost = {
        key: await route.request().headerValue('idempotency-key'),
        status: original.status(),
        plan: (await original.json()) as { plan_id: string },
      };
      await route.abort('connectionfailed');
    });
    await professional.getByRole('button', { name: 'Confirmar y asignar' }).click();
    await expect(professional.getByTestId('nutrition-error')).toContainText('No hay conexión');
    await professional.unrouteAll({ behavior: 'wait' });
    expect(lost, 'la primera confirmación debía llegar al BFF').not.toBeNull();
    const first = lost!;
    expect(first.status, 'la primera confirmación debía crear el plan').toBe(201);
    expect(first.key).toMatch(UUID);

    const created = await confirm(professional);
    await expectStatus(created, 201);
    expect(await created.request().headerValue('idempotency-key')).toBe(first.key);
    expect(await created.headerValue('idempotent-replayed')).toBe('true');
    const plan = (await created.json()) as {
      plan_id: string;
      status: string;
      version: number;
      warnings: string[];
    };
    expect(plan.plan_id).toBe(first.plan.plan_id);
    expect(plan.status).toBe('ASSIGNED');
    expect(plan.version).toBe(1);
    // CA6: la cuenta sintética no tiene hábitos registrados (HU009).
    expect(plan.warnings).toEqual(['nutrition_habits_missing']);
    await expect(professional.getByTestId('nutrition-created')).toContainText('Plan asignado');
    await expect(professional.getByTestId('nutrition-warning-habits')).toBeVisible();
    await expect(professional.getByTestId('nutrition-replayed')).toBeVisible();

    // CA4 y CA5: la lectura es eventual; mientras se proyecta la consulta responde 404.
    await professional.getByRole('link', { name: 'Consultar el plan' }).click();
    await expect(professional).toHaveURL(
      new RegExp(`/profesional/alimentacion/planes/${plan.plan_id}$`),
    );
    await expect(async () => {
      const retry = professional.getByTestId('nutrition-not-found').getByRole('button');
      if (await retry.isVisible()) {
        await retry.click();
      }
      await expect(professional.getByTestId('nutrition-detail-status')).toHaveText('Asignado', {
        timeout: 2_000,
      });
    }, 'la lectura del plan debía quedar proyectada (outbox → Pub/Sub → proyector)').toPass({
      timeout: 60_000,
    });
    await expect(professional.getByTestId('nutrition-summary')).toContainText('Avena');

    // CA5: el deportista ve el plan en «Mi alimentación» una vez proyectado.
    await athlete.locator('mat-sidenav [data-menu-item="athlete-nutrition"]').click();
    await expect(athlete).toHaveURL(/\/deportista\/alimentacion$/);
    const titles = athlete.getByTestId('athlete-nutrition-list').locator('mat-panel-title');
    await expect(async () => {
      if ((await titles.count()) === 0) {
        const list = waitForOperation(athlete, 'GET', /^\/v1\/me\/nutrition-plans$/);
        await athlete.reload();
        await expectStatus(await list, 200);
      }
      await expect(titles).toHaveText(['Plan de alimentación sintético E2E'], { timeout: 2_000 });
    }, 'el deportista debía ver el plan proyectado').toPass({ timeout: 60_000 });
    await expect(athlete.getByTestId('athlete-nutrition-status')).toHaveText('Asignado');

    // CA3: otro profesional, sin autorización del deportista, no puede asignarle planes.
    await openEditor(outsider, outsiderEmail);
    await fillPlan(outsider, athleteEmail);
    const rejected = await confirm(outsider);
    await expectStatus(rejected, 403);
    expect(((await rejected.json()) as { code: string }).code).toBe(
      'athlete_authorization_required',
    );
    await expect(outsider.locator('mat-error').first()).toContainText(
      'no corresponde a un deportista que te haya autorizado',
    );

    // CA3: un tercero recibe 404 al consultar un plan ajeno.
    const read = waitForOperation(outsider, 'GET', /^\/v1\/nutrition-plans\/[^/]+$/);
    await outsider.goto(`/profesional/alimentacion/planes/${plan.plan_id}`);
    await expectStatus(await read, 404);
    await expect(outsider.getByTestId('nutrition-not-found')).toBeVisible();
    await expect(outsider.getByTestId('nutrition-summary')).toHaveCount(0);
  });

  test('CA3: un deportista no tiene el editor de planes de alimentación', async ({ page }) => {
    const athleteEmail = uniqueEmail('deportista-sin-editor');
    await register(page, athleteEmail, 'Deportista');
    await login(page, athleteEmail, /\/deportista\/inicio$/);
    await expect(page.locator('mat-sidenav [data-menu-item="nutrition-plans"]')).toHaveCount(0);

    await page.goto('/profesional/alimentacion/planes');

    await expect(page).toHaveURL(/\/acceso-no-autorizado$/);
  });
});
