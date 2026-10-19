import { Page, Response, expect, test } from '@playwright/test';

/**
 * HU001 de punta a punta, sin simuladores: Angular → BFF web → users-management →
 * Pub/Sub → affiliation-management, contra el ambiente de `PLAYWRIGHT_BASE_URL`
 * (su `app-config.json` define el BFF y la versión de políticas). Requiere que
 * users-management acepte `sportapp-c108-c108plus.v1` (`REGISTRATION_POLICIES_VERSION`)
 * y que el consumidor del plan `FREE` esté suscrito (`T-HU001-PLAT`). Crea cuentas
 * sintéticas con un correo único por ejecución (`e2e-hu001-…@example.com`). Ante un
 * fallo, el mensaje deja la operación, el estado, el `code` y el `correlation_id`.
 */

const VERSION = 'sportapp-c108-c108plus.v1';
const PASSWORD = 'clave-sintetica-e2e-123';
/** Capacidades del plan `FREE` en el catálogo precargado (ADR-024, `planes/01`). */
const FREE_CAPABILITIES = 11;

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

function uniqueEmail(role: string): string {
  return `e2e-hu001-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

function waitForOperation(page: Page, method: string, path: string): Promise<Response> {
  return page.waitForResponse(
    (r) => r.request().method() === method && new URL(r.url()).pathname === path,
  );
}

/** Cuerpo de error del BFF, si lo hay. */
async function errorOf(response: Response): Promise<{ code?: string; correlation_id?: string }> {
  try {
    return (await response.json()) as { code?: string; correlation_id?: string };
  } catch {
    return {};
  }
}

/** Comprueba el estado HTTP y, si no coincide, deja la evidencia del BFF. */
async function expectStatus(response: Response, expected: number): Promise<void> {
  if (response.status() === expected) {
    return;
  }
  const body = await errorOf(response);
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

/** Registro aceptado: versión aprobada enviada y sin rastro de la contraseña. */
async function expectRegistered(page: Page, created: Response, email: string): Promise<string> {
  expect(created.request().postDataJSON().accepted_policies_version).toBe(VERSION);
  await expectStatus(created, 201);
  const body = (await created.json()) as { user_id: string; email: string };
  expect(body.email).toBe(email);
  expect(JSON.stringify(body)).not.toContain(PASSWORD);
  await expect(page.getByTestId('registration-success')).toContainText(email);
  await expect(page.getByLabel('Contraseña', { exact: true })).toHaveCount(0);
  const stored = await page.evaluate(() =>
    JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage), document.cookie]),
  );
  expect(stored).not.toContain(PASSWORD);
  expect(await page.content()).not.toContain(PASSWORD);
  return body.user_id;
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
  test('athlete: registro 201, PROVISIONING → FREE ACTIVE con 11 capacidades y estado recuperable', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const email = uniqueEmail('deportista');
    await expectRegistered(page, await register(page, email, ACTORS.athlete.label), email);

    const first = await login(page, email, ACTORS.athlete.home);
    expect(first.actor_type).toBe('athlete');
    // Evidencia: el estado con el que llegó la primera consulta (depende de la velocidad del consumidor).
    test.info().annotations.push({
      type: 'subscription_status_inicial',
      description: first.subscription_status,
    });
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
    expect(current.capabilities).toHaveLength(FREE_CAPABILITIES);
    expect(new Set(current.capabilities).size).toBe(FREE_CAPABILITIES);
    await expect(page.getByTestId('shell-plan-provisioning')).toHaveCount(0);
    await expect(
      page.locator('mat-sidenav [data-menu-item="athlete-training-plans"]'),
    ).toBeVisible();

    // CA8: el estado se recupera en una sesión nueva sin repetir el registro.
    const logout = waitForOperation(page, 'POST', '/v1/sessions/revoke');
    await page.locator('mat-sidenav [data-menu-item="logout"]').click();
    await expectStatus(await logout, 204);
    const again = await login(page, email, ACTORS.athlete.home);
    expect(again.subscription_status).toBe('ACTIVE');
    expect(again.plan_code).toBe('FREE');
    expect([...again.capabilities].sort()).toEqual([...current.capabilities].sort());
  });

  test('reintento y correo repetido: la misma clave devuelve el registro original y el correo repetido da 409 estable', async ({
    page,
  }) => {
    const email = uniqueEmail('reintento');
    const created = await register(page, email, ACTORS.athlete.label);
    const userId = await expectRegistered(page, created, email);

    // CA5: el mismo intento (misma Idempotency-Key y cuerpo) contra el BFF real.
    const key = await created.request().headerValue('idempotency-key');
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    const replay = await page.request.post(created.url(), {
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key! },
      data: created.request().postData()!,
    });
    expect(replay.status()).toBe(201);
    expect(replay.headers()['idempotent-replayed']).toBe('true');
    expect(((await replay.json()) as { user_id: string }).user_id).toBe(userId);

    // CA2: un intento nuevo con el mismo correo se rechaza siempre con el mismo código.
    for (let attempt = 0; attempt < 2; attempt++) {
      const duplicated = await register(page, email, ACTORS.athlete.label);
      await expectStatus(duplicated, 409);
      expect((await errorOf(duplicated)).code).toBe('email_already_registered');
      expect(await duplicated.request().headerValue('idempotency-key')).not.toBe(key);
      await expect(
        page.getByText('Ya existe una cuenta con este correo electrónico.'),
      ).toBeVisible();
    }
  });

  for (const actor of ['organizer', 'service_provider'] as const) {
    test(`${actor}: registro 201, NOT_APPLICABLE y sin suscripción de deportista`, async ({
      page,
    }) => {
      const email = uniqueEmail(actor.replace('_', '-'));
      await expectRegistered(page, await register(page, email, ACTORS[actor].label), email);

      const capabilities = await login(page, email, ACTORS[actor].home);

      // CA7: sin suscripción de deportista ni capacidades de plan.
      expect(capabilities.actor_type).toBe(actor);
      expect(capabilities.subscription_status).toBe('NOT_APPLICABLE');
      expect(capabilities.plan_code).toBeNull();
      expect(capabilities.capabilities).toEqual([]);
      await expect(page.getByTestId('shell-plan-provisioning')).toHaveCount(0);
    });
  }
});
