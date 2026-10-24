import { Page, Response, expect, test } from '@playwright/test';

/**
 * HU016 de punta a punta: Angular → BFF web → affiliation-management, contra el
 * ambiente de `PLAYWRIGHT_BASE_URL`. Requiere `bff-web` 0.20.0 o superior y
 * `affiliation-management` 0.3.0 con las migraciones `0003_plan_price_offers` y
 * `0004_subscription_changes`, `AFFILIATION_EXPECTED_CATALOG_VERSION=plans-2026-10-13.v1`
 * y el consumidor del alta `FREE` activo. Registra un deportista sintético con un
 * correo único por ejecución. Ante un fallo, el mensaje deja la operación, el
 * estado, el `code` y el `correlation_id`.
 */

const PASSWORD = 'clave-sintetica-e2e-123';
const CAPABILITIES_PATH = '/v1/me/capabilities';
const CHANGES_PATH = '/v1/me/subscription/changes';
/** Las cinco capacidades que `PREMIUM` agrega a `FREE` (ADR-024). */
const PREMIUM_OVER_FREE = [
  'training.realtime.monitor',
  'devices.measurement.connect',
  'nutrition.session.reminders',
  'services.sports_medicine.access',
  'services.virtual_sessions.schedule',
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface Capabilities {
  readonly subscription_status: string;
  readonly plan_code: string | null;
  readonly capabilities: readonly string[];
}

function uniqueEmail(): string {
  return `e2e-hu016-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

function waitForOperation(page: Page, method: string, path: string): Promise<Response> {
  return page.waitForResponse(
    (r) => r.request().method() === method && new URL(r.url()).pathname === path,
  );
}

/** Comprueba el estado HTTP y, si no coincide, deja la evidencia del BFF. */
async function expectStatus(response: Response, expected: number): Promise<void> {
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
    `${response.request().method()} ${new URL(response.url()).pathname} → ${response.status()}` +
      ` code=${body.code ?? '-'} correlation_id=${body.correlation_id ?? '-'}`,
  ).toBe(expected);
}

/** Registra un deportista, inicia sesión y espera a que su plan `FREE` quede `ACTIVE`. */
async function registerActiveAthlete(page: Page): Promise<void> {
  const email = uniqueEmail();
  await page.goto('/registro');
  await page.getByLabel('Nombre completo').fill('Persona Sintética E2E');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Tipo de usuario').click();
  await page.getByRole('option', { name: 'Deportista' }).click();
  await page.getByLabel(/Acepto las políticas/).check();
  const created = waitForOperation(page, 'POST', '/v1/users');
  await page.getByRole('button', { name: 'Registrarme' }).click();
  await expectStatus(await created, 201);

  await page.goto('/iniciar-sesion');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  let capabilities = waitForOperation(page, 'GET', CAPABILITIES_PATH);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).toHaveURL(/\/deportista\/inicio$/);
  let current = await read(await capabilities);

  // La activación del plan gratuito es asíncrona (ADR-024).
  await expect(async () => {
    if (current.subscription_status !== 'ACTIVE') {
      capabilities = waitForOperation(page, 'GET', CAPABILITIES_PATH);
      await page.reload();
      current = await read(await capabilities);
    }
    expect(current.subscription_status, 'la suscripción FREE debía quedar ACTIVE').toBe('ACTIVE');
  }).toPass({ timeout: 90_000, intervals: [2_000, 5_000] });
  expect(current.plan_code).toBe('FREE');
}

async function read(response: Response): Promise<Capabilities> {
  await expectStatus(response, 200);
  return (await response.json()) as Capabilities;
}

const menuItem = (page: Page, id: string) => page.locator(`mat-sidenav [data-menu-item="${id}"]`);
const plan = (page: Page, code: string) => page.locator(`[data-plan="${code}"]`);
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

async function openMyPlan(page: Page): Promise<void> {
  const plans = waitForOperation(page, 'GET', '/v1/plans');
  await menuItem(page, 'plan').click();
  await expect(page).toHaveURL(/\/deportista\/plan$/);
  await expectStatus(await plans, 200);
}

/**
 * Confirma el cambio y devuelve la respuesta del comando y la nueva consulta de
 * capacidades que lo sigue (CA8).
 */
async function confirmChange(page: Page): Promise<{ change: Response; after: Capabilities }> {
  const change = waitForOperation(page, 'POST', CHANGES_PATH);
  const capabilities = page.waitForResponse(
    async (r) =>
      r.request().method() === 'GET' &&
      new URL(r.url()).pathname === CAPABILITIES_PATH &&
      // Solo la consulta posterior al cambio.
      (await change.then(() => true)),
  );
  await button(page, 'Confirmar cambio').click();
  const response = await change;
  await expectStatus(response, 200);
  return { change: response, after: await read(await capabilities) };
}

test.describe('HU016 Mi plan contra el BFF web @integrado', () => {
  test('CA1, CA6, CA7 y CA8: un deportista FREE sube a PREMIUM trimestral, ve las cinco opciones nuevas y vuelve a FREE', async ({
    page,
  }) => {
    await registerActiveAthlete(page);
    await expect(menuItem(page, 'sports-medicine')).toHaveCount(0);
    await openMyPlan(page);

    // CA7: FREE es el plan actual sin selección manual.
    await expect(page.getByTestId('my-plan-current-name')).toHaveText('Gratuito');
    await expect(plan(page, 'FREE').getByTestId('my-plan-current-badge')).toBeVisible();
    await expect(page.locator('[data-plan]')).toHaveCount(3);
    await expect(plan(page, 'PREMIUM').getByTestId('my-plan-offers')).toContainText(
      /Trimestral: \$\s14\.400/,
    );

    // CA1: FREE → PREMIUM trimestral con el aviso de no cobro.
    await plan(page, 'PREMIUM').getByRole('button', { name: 'Elegir Premium' }).click();
    await page.getByRole('radio', { name: /^Trimestral/ }).check();
    await button(page, 'Continuar').click();
    await expect(page.getByTestId('my-plan-payment-notice')).toHaveText(
      'SportApp no procesa el pago; se registra un compromiso informativo.',
    );
    const upgrade = await confirmChange(page);
    const premium = (await upgrade.change.json()) as Record<string, unknown>;
    expect(upgrade.change.request().postDataJSON()).toEqual({
      plan_code: 'PREMIUM',
      periodicity: 'QUARTERLY',
      expected_subscription_version: 1,
    });
    expect(await upgrade.change.request().headerValue('idempotency-key')).toMatch(UUID);
    expect(premium).toEqual(
      expect.objectContaining({
        plan_code: 'PREMIUM',
        periodicity: 'QUARTERLY',
        status: 'ACTIVE',
        version: 2,
      }),
    );
    expect(premium['period_start']).toBeTruthy();
    expect(premium['period_end']).toBeTruthy();
    await expect(page.getByTestId('my-plan-changed')).toContainText(
      'Ahora tienes el plan Premium.',
    );
    await expect(page.getByTestId('my-plan-result-payment')).toContainText(
      'compromiso informativo pendiente de pago externo',
    );

    // CA8: las capacidades vigentes incluyen las cinco nuevas y el menú se reconstruye.
    expect(upgrade.after.plan_code).toBe('PREMIUM');
    expect(upgrade.after.capabilities).toEqual(expect.arrayContaining(PREMIUM_OVER_FREE));
    await expect(menuItem(page, 'sports-medicine')).toHaveAttribute(
      'href',
      '/deportista/servicios/medico-deportivos',
    );
    await expect(page.getByTestId('my-plan-menu-status')).toHaveText(
      'Tu menú ya muestra las opciones de tu plan.',
    );
    await expect(page.getByTestId('my-plan-current-periodicity')).toHaveText('Trimestral');

    // CA6: volver a FREE; las opciones pagas desaparecen.
    await plan(page, 'FREE').getByRole('button', { name: 'Elegir Gratuito' }).click();
    await button(page, 'Continuar').click();
    const downgrade = await confirmChange(page);
    expect(downgrade.change.request().postDataJSON()).toEqual({
      plan_code: 'FREE',
      periodicity: 'NONE',
      expected_subscription_version: 2,
    });
    expect(downgrade.after.plan_code).toBe('FREE');
    for (const capability of PREMIUM_OVER_FREE) {
      expect(downgrade.after.capabilities).not.toContain(capability);
    }
    await expect(page.getByTestId('my-plan-result-payment')).toContainText('quedaron sin efecto');
    await expect(menuItem(page, 'sports-medicine')).toHaveCount(0);

    // Una URL escrita no omite la guarda tras bajar de plan.
    await page.goto('/deportista/servicios/medico-deportivos');
    await expect(page).toHaveURL(/\/acceso-no-autorizado$/);
  });

  test('CA4: una pestaña con la versión vieja recibe 409 version_conflict sin cambiar el plan', async ({
    page,
  }) => {
    await registerActiveAthlete(page);
    await openMyPlan(page);
    const other = await page.context().newPage();
    await other.goto('/deportista/plan');
    await expect(other.getByTestId('my-plan-current-name')).toHaveText('Gratuito');

    await plan(page, 'INTERMEDIATE').getByRole('button', { name: 'Elegir Intermedio' }).click();
    await page.getByRole('radio', { name: /^Mensual/ }).check();
    await button(page, 'Continuar').click();
    await confirmChange(page);
    await expect(page.getByTestId('my-plan-current-name')).toHaveText('Intermedio');

    await plan(other, 'PREMIUM').getByRole('button', { name: 'Elegir Premium' }).click();
    await other.getByRole('radio', { name: /^Anual/ }).check();
    await button(other, 'Continuar').click();
    const stale = waitForOperation(other, 'POST', CHANGES_PATH);
    await button(other, 'Confirmar cambio').click();
    await expectStatus(await stale, 409);
    expect(((await (await stale).json()) as { code: string }).code).toBe('version_conflict');
    await expect(other.getByTestId('my-plan-error')).toContainText(
      'Tu plan cambió mientras lo revisabas',
    );

    await other.getByRole('button', { name: 'Recargar mi plan' }).click();
    await expect(other.getByTestId('my-plan-current-name')).toHaveText('Intermedio');
    await expect(other.getByTestId('my-plan-current-periodicity')).toHaveText('Mensual');
  });
});
