import { Page, Response, expect, test } from '@playwright/test';

/**
 * HU001 de punta a punta, sin simuladores: Angular → BFF web → users-management →
 * Pub/Sub → affiliation-management, contra el ambiente de `PLAYWRIGHT_BASE_URL`
 * (su `app-config.json` define el BFF y la versión de políticas). Requiere que
 * users-management acepte `sportapp-c108-c108plus.v1` (`REGISTRATION_POLICIES_VERSION`)
 * y que el consumidor del plan `FREE` esté suscrito. Crea cuentas sintéticas con un
 * correo único por ejecución. Ante un fallo, el mensaje deja la operación, el
 * estado, el `code` y el `correlation_id` del BFF.
 */

const VERSION = 'sportapp-c108-c108plus.v1';
const PASSWORD = 'clave-sintetica-e2e-123';

const ACTORS = {
  athlete: { label: 'Deportista', home: /\/deportista\/inicio$/ },
  organizer: { label: 'Organizador de eventos', home: /\/organizador\/inicio$/ },
  service_provider: { label: 'Profesional de servicios', home: /\/profesional\/inicio$/ },
} as const;

interface Capabilities {
  readonly actor_type: string;
  readonly subscription_status: string;
  readonly plan_code: string | null;
  readonly capabilities: readonly string[];
}

function uniqueEmail(): string {
  return `e2e-hu001-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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

async function register(page: Page, email: string, label: string): Promise<Response> {
  await page.goto('/registro');
  await page.getByLabel('Nombre completo').fill('Persona Sintética E2E');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Tipo de usuario').click();
  await page.getByRole('option', { name: label }).click();
  await page.getByLabel(/Acepto las políticas/).check();
  const created = waitForOperation(page, 'POST', '/v1/users');
  await page.getByRole('button', { name: 'Registrarme' }).click();
  return created;
}

async function login(page: Page, email: string, home: RegExp): Promise<Capabilities> {
  await page.goto('/iniciar-sesion');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  const capabilities = waitForOperation(page, 'GET', '/v1/me/capabilities');
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).toHaveURL(home);
  const response = await capabilities;
  await expectStatus(response, 200);
  return (await response.json()) as Capabilities;
}

test.describe('HU001 Registrar usuario contra el BFF web @integrado', () => {
  test('CA1 y CA2: registra una cuenta nueva con la versión aprobada y rechaza el mismo correo', async ({
    page,
  }) => {
    const email = uniqueEmail();

    const created = await register(page, email, ACTORS.athlete.label);
    expect(created.request().postDataJSON().accepted_policies_version).toBe(VERSION);
    await expectStatus(created, 201);
    await expect(page.getByRole('status')).toContainText(email);

    const duplicated = await register(page, email, ACTORS.athlete.label);
    await expectStatus(duplicated, 409);
    await expect(page.getByText('Ya existe una cuenta con este correo electrónico.')).toBeVisible();
  });

  test('CA6 y CA8: el deportista pasa de PROVISIONING a FREE ACTIVE con capacidades', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const email = uniqueEmail();
    await expectStatus(await register(page, email, ACTORS.athlete.label), 201);

    const first = await login(page, email, ACTORS.athlete.home);
    expect(first.actor_type).toBe('athlete');
    if (first.subscription_status === 'PROVISIONING') {
      // CA8: mientras se activa no se conceden capacidades y se informa el estado.
      expect(first.capabilities).toEqual([]);
      await expect(page.getByTestId('shell-plan-provisioning')).toBeVisible();
    }

    // La activación es asíncrona (ADR-024): se vuelve a consultar sin repetir el registro.
    let current = first;
    await expect(async () => {
      if (current.subscription_status !== 'ACTIVE') {
        const capabilities = waitForOperation(page, 'GET', '/v1/me/capabilities');
        await page.reload();
        const response = await capabilities;
        await expectStatus(response, 200);
        current = (await response.json()) as Capabilities;
      }
      expect(current.subscription_status, 'la suscripción FREE debía quedar ACTIVE').toBe('ACTIVE');
    }).toPass({ timeout: 90_000, intervals: [2_000, 5_000] });

    // CA6: plan FREE con sus capacidades, tal como las entrega el backend.
    expect(current.plan_code).toBe('FREE');
    expect(current.capabilities.length).toBeGreaterThan(0);
    await expect(page.getByTestId('shell-plan-provisioning')).toHaveCount(0);
    await expect(
      page.locator('mat-sidenav [data-menu-item="athlete-training-plans"]'),
    ).toBeVisible();
  });

  for (const actor of ['organizer', 'service_provider'] as const) {
    test(`CA7: «${ACTORS[actor].label}» no recibe una suscripción de deportista`, async ({
      page,
    }) => {
      const email = uniqueEmail();
      await expectStatus(await register(page, email, ACTORS[actor].label), 201);

      const capabilities = await login(page, email, ACTORS[actor].home);

      expect(capabilities.actor_type).toBe(actor);
      expect(capabilities.subscription_status).toBe('NOT_APPLICABLE');
      expect(capabilities.plan_code).toBeNull();
      expect(capabilities.capabilities).toEqual([]);
      await expect(page.getByTestId('shell-plan-provisioning')).toHaveCount(0);
    });
  }
});
