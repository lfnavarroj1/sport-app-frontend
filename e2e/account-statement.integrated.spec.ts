import { Page, Response, expect, test } from '@playwright/test';

/**
 * HU007 de punta a punta: Angular → BFF web → affiliation-management, contra el
 * ambiente de `PLAYWRIGHT_BASE_URL`. Requiere `bff-web` 0.27.0 o superior y
 * `affiliation-management` 0.4.0 (más lo que exige HU016: catálogo
 * `plans-2026-10-13.v1` y el consumidor del alta `FREE` activo). Registra cuentas
 * sintéticas con un correo único por ejecución. Ante un fallo, el mensaje deja la
 * operación, el estado, el `code` y el `correlation_id`.
 */

const PASSWORD = 'clave-sintetica-e2e-123';
const CAPABILITIES_PATH = '/v1/me/capabilities';
const STATEMENT_PATH = '/v1/me/account-statement';

interface Statement {
  readonly statement_status: string;
  readonly subscription: { readonly plan_code: string | null } | null;
  readonly commitments: readonly { readonly status: string; readonly plan_code: string }[];
  readonly movements: readonly { readonly movement_type: string }[];
  readonly payments_status: string;
  readonly balance: null;
}

function uniqueEmail(actor: string): string {
  return `e2e-hu007-${actor}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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

/** Registra una cuenta del actor indicado e inicia sesión. */
async function registerAndLogin(page: Page, actorLabel: string, area: string): Promise<void> {
  const email = uniqueEmail(area);
  await page.goto('/registro');
  await page.getByLabel('Nombre completo').fill('Persona Sintética E2E');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Tipo de usuario').click();
  await page.getByRole('option', { name: actorLabel }).click();
  await page.getByLabel(/Acepto las políticas/).check();
  const created = waitForOperation(page, 'POST', '/v1/users');
  await page.getByRole('button', { name: 'Registrarme' }).click();
  await expectStatus(await created, 201);

  await page.goto('/iniciar-sesion');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).toHaveURL(new RegExp(`/${area}/inicio$`));
}

/** Espera a que el plan `FREE` del deportista quede `ACTIVE` (alta asíncrona, ADR-024). */
async function waitForFreePlan(page: Page): Promise<void> {
  await expect(async () => {
    const capabilities = waitForOperation(page, 'GET', CAPABILITIES_PATH);
    await page.reload();
    const response = await capabilities;
    await expectStatus(response, 200);
    const body = (await response.json()) as { subscription_status: string };
    expect(body.subscription_status, 'la suscripción FREE debía quedar ACTIVE').toBe('ACTIVE');
  }).toPass({ timeout: 90_000, intervals: [2_000, 5_000] });
}

async function readStatement(response: Response): Promise<Statement> {
  await expectStatus(response, 200);
  return (await response.json()) as Statement;
}

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

test.describe('HU007 Estado de cuenta contra el BFF web @integrado', () => {
  test('CA1, CA3 y CA4: tras subir a PREMIUM trimestral, el deportista ve su compromiso PENDING_EXTERNAL y sus movimientos', async ({
    page,
  }) => {
    await registerAndLogin(page, 'Deportista', 'deportista');
    await waitForFreePlan(page);

    await page.locator('mat-sidenav [data-menu-item="plan"]').click();
    await expect(page).toHaveURL(/\/deportista\/plan$/);
    await page.locator('[data-plan="PREMIUM"]').getByRole('button', { name: 'Elegir Premium' }).click();
    await page.getByRole('radio', { name: /^Trimestral/ }).check();
    await button(page, 'Continuar').click();
    const change = waitForOperation(page, 'POST', '/v1/me/subscription/changes');
    await button(page, 'Confirmar cambio').click();
    await expectStatus(await change, 200);

    const loaded = waitForOperation(page, 'GET', STATEMENT_PATH);
    await page.getByTestId('my-plan-statement-link').click();
    await expect(page).toHaveURL(/\/deportista\/perfil#estado-de-cuenta$/);
    const response = await loaded;
    const body = await readStatement(response);

    // CA3: la cuenta sale del token.
    expect([...new URL(response.url()).searchParams.keys()]).toEqual(['limit']);
    expect(body.statement_status).toBe('ACTIVE');
    expect(body.subscription?.plan_code).toBe('PREMIUM');
    expect(body.payments_status).toBe('NOT_INTEGRATED');
    expect(body.balance).toBeNull();
    expect(body.commitments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ plan_code: 'PREMIUM', status: 'PENDING_EXTERNAL' }),
      ]),
    );
    expect(body.movements.map((m) => m.movement_type)).toEqual(
      expect.arrayContaining(['FREE_ACTIVATED', 'PLAN_CHANGED', 'COMMITMENT_CREATED']),
    );

    await expect(page.getByTestId('account-statement-plan')).toHaveText('Premium');
    await expect(page.getByTestId('account-statement-offer')).toHaveText('Trimestral');
    await expect(page.getByTestId('account-statement-payments')).toContainText(
      'SportApp no registra pagos',
    );
    await expect(
      page.locator('[data-testid="account-statement-commitments"] li[data-commitment-status="PENDING_EXTERNAL"]'),
    ).toHaveCount(1);
    await expect(page.getByTestId('account-statement').locator('tbody tr')).toHaveCount(
      body.movements.length,
    );
  });

  test('CA2: el organizador ve NOT_APPLICABLE en «Mi perfil», sin error', async ({ page }) => {
    await registerAndLogin(page, 'Organizador de eventos', 'organizador');

    const loaded = waitForOperation(page, 'GET', STATEMENT_PATH);
    await page.locator('mat-sidenav [data-menu-item="profile"]').click();
    await expect(page).toHaveURL(/\/organizador\/perfil$/);
    const body = await readStatement(await loaded);

    expect(body.statement_status).toBe('NOT_APPLICABLE');
    expect(body.subscription).toBeNull();
    expect(body.commitments).toEqual([]);
    expect(body.movements).toEqual([]);
    await expect(page.getByTestId('account-statement-not-applicable')).toBeVisible();
    await expect(page.getByTestId('account-statement').getByRole('alert')).toHaveCount(0);
  });
});
