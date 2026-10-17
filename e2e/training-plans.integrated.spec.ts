import { Browser, Page, Response, expect, test } from '@playwright/test';

/**
 * HU010 de punta a punta: Angular → BFF web → users-management (lookup por
 * correo) → training-management (escritura, outbox y proyección), contra el
 * ambiente de `PLAYWRIGHT_BASE_URL`. Requiere `bff-web` 0.6.0 o una versión
 * compatible posterior (las operaciones de HU010 no cambian hasta 0.13.0), el
 * plan `FREE` activo del deportista (capacidad `training.plan.manage`, que
 * activa `affiliation-management-free-plan-consumer`), el proyector de lectura
 * de Usuarios (`user_directory`, para el lookup) y el publicador y el proyector
 * de Entrenamientos. Registra cuentas sintéticas con correos únicos.
 */

const PASSWORD = 'clave-sintetica-e2e-123';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function uniqueEmail(role: string): string {
  return `e2e-hu010-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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
 * El deportista recibe la capacidad `training.plan.manage` de su plan `FREE`
 * (se activa por mensajería, ADR-024) y autoriza al profesional por correo.
 */
async function authorize(page: Page, athlete: string, professional: string): Promise<void> {
  await register(page, athlete, 'Deportista');
  await login(page, athlete, /\/deportista\/inicio$/);
  const option = page.locator('mat-sidenav [data-menu-item="athlete-training-plans"]');
  await expect(async () => {
    // La suscripción pasa de PROVISIONING a ACTIVE de forma asíncrona: se vuelve a
    // consultar `GET /v1/me/capabilities` recargando hasta que aparezca la opción.
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
}

async function fillPlan(page: Page, athlete: string): Promise<void> {
  await page.getByLabel('Correo del deportista').fill(athlete);
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
}

/** Confirma la asignación y devuelve la respuesta de `POST /v1/training-plans`. */
async function confirm(page: Page): Promise<Response> {
  const response = waitForOperation(page, 'POST', /^\/v1\/training-plans$/);
  await page.getByRole('button', { name: 'Confirmar y asignar' }).click();
  return response;
}

async function openPlansAsProfessional(page: Page, email: string): Promise<void> {
  await login(page, email, /\/profesional\/inicio$/);
  await page.locator('mat-sidenav [data-menu-item="training-plans"]').click();
  await expect(page).toHaveURL(/\/profesional\/entrenamientos\/planes$/);
}

test.describe('HU010 Crear plan de entrenamiento contra el BFF web @integrado', () => {
  test('CA1, CA2, CA4 y CA5: autorizar, asignar con Idempotency-Key, consultar proyectado y rechazar a un tercero', async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const athleteEmail = uniqueEmail('deportista');
    const professionalEmail = uniqueEmail('profesional');
    const outsiderEmail = uniqueEmail('otro-profesional');
    const professional = await newPage(browser);
    const outsider = await newPage(browser);
    await register(professional, professionalEmail, 'Profesional de servicios');
    await register(outsider, outsiderEmail, 'Profesional de servicios');

    await authorize(await newPage(browser), athleteEmail, professionalEmail);

    // CA1 y CA5: el profesional autorizado asigna el plan con una clave de idempotencia.
    await openPlansAsProfessional(professional, professionalEmail);
    await fillPlan(professional, athleteEmail);
    const created = await confirm(professional);
    await expectStatus(created, 201);
    expect(await created.request().headerValue('idempotency-key')).toMatch(UUID);
    expect(await created.headerValue('idempotent-replayed')).not.toBe('true');
    const plan = (await created.json()) as { plan_id: string; status: string; version: number };
    expect(plan.status).toBe('ASSIGNED');
    expect(plan.version).toBe(1);
    await expect(professional.getByTestId('plan-created')).toContainText('Plan asignado');

    // CA4: la outbox publica y la lectura es eventual; mientras se proyecta,
    // la consulta responde 404 y la pantalla ofrece reintentar.
    await professional.getByRole('link', { name: 'Consultar el plan' }).click();
    await expect(professional).toHaveURL(
      new RegExp(`/profesional/entrenamientos/planes/${plan.plan_id}$`),
    );
    await expect(async () => {
      const retry = professional.getByTestId('plan-not-found').getByRole('button');
      if (await retry.isVisible()) {
        await retry.click();
      }
      await expect(professional.getByTestId('plan-summary-title')).toHaveText(
        'Plan sintético E2E',
        { timeout: 2_000 },
      );
    }, 'la lectura del plan debía quedar proyectada (outbox → Pub/Sub → proyector)').toPass({
      timeout: 60_000,
    });

    // CA2: otro profesional, sin autorización de ese deportista, no puede asignarle planes.
    await openPlansAsProfessional(outsider, outsiderEmail);
    await fillPlan(outsider, athleteEmail);
    const rejected = await confirm(outsider);
    await expectStatus(rejected, 403);
    expect(((await rejected.json()) as { code: string }).code).toBe(
      'athlete_authorization_required',
    );
    await expect(outsider.locator('mat-error')).toContainText(
      'no corresponde a un deportista que te haya autorizado',
    );

    // CA4: el plan no es visible para ese tercero (el contrato responde 404, no lo revela).
    const read = waitForOperation(outsider, 'GET', /^\/v1\/training-plans\/[^/]+$/);
    await outsider.goto(`/profesional/entrenamientos/planes/${plan.plan_id}`);
    await expectStatus(await read, 404);
    await expect(outsider.getByTestId('plan-not-found')).toBeVisible();
    await expect(outsider.getByTestId('plan-summary-title')).toHaveCount(0);
  });

  test('CA2: sin autorización del deportista la asignación se rechaza', async ({ page }) => {
    const professionalEmail = uniqueEmail('profesional');
    await register(page, professionalEmail, 'Profesional de servicios');
    await openPlansAsProfessional(page, professionalEmail);

    await fillPlan(page, uniqueEmail('sin-autorizacion'));

    await expectStatus(await confirm(page), 403);
    await expect(page.locator('mat-error')).toContainText(
      'no corresponde a un deportista que te haya autorizado',
    );
  });
});
