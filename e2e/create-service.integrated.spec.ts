import { Browser, Page, Response, expect, test } from '@playwright/test';

/**
 * HU015 de punta a punta: Angular → BFF web → complementary-services, contra el
 * ambiente de `PLAYWRIGHT_BASE_URL`. Requiere `bff-web` 0.9.0 o superior y
 * `complementary-services` 0.2.0 (ADR-027). Registra cuentas sintéticas con un
 * correo único por ejecución.
 */

const PASSWORD = 'clave-sintetica-e2e-123';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ZONE = 'America/Bogota';

function uniqueEmail(actor: string): string {
  return `e2e-hu015-${actor}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

/** Día `YYYY-MM-DD` en Bogotá, `days` días después de hoy. */
function bogotaDate(days: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(
    new Date(Date.now() + days * 86_400_000),
  );
}

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
  await page.getByRole('button', { name: 'Registrarme' }).click();
  await expect(page.getByRole('status')).toContainText(email);
}

/** Inicia sesión y devuelve el access token que entregó el BFF. */
async function login(page: Page, email: string, home: RegExp): Promise<string> {
  await page.goto('/iniciar-sesion');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  const session = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/v1/sessions' && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Ingresar' }).click();
  const body = (await (await session).json()) as { access_token: string };
  await expect(page).toHaveURL(home);
  return body.access_token;
}

async function choose(page: Page, label: string, option: string): Promise<void> {
  // Se pulsa el campo completo: la etiqueta de un `mat-select` vacío cubre el disparador.
  await page.locator('mat-form-field', { has: page.getByLabel(label) }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

async function fillService(page: Page, name: string): Promise<void> {
  await page.getByLabel('Nombre del servicio').fill(name);
  await page
    .getByLabel('Descripción')
    .fill('Servicio sintético creado por la prueba integrada de HU015.');
  await choose(page, 'Categoría', 'Entrenamiento');
  await choose(page, 'Modalidad', 'Virtual');
  await page.getByLabel('Valor').fill('85000,50');
  await choose(page, 'Unidad de cobro', 'Por hora');
}

async function addInterval(page: Page, date: string, start: string, end: string): Promise<void> {
  await page.getByRole('button', { name: 'Agregar horario' }).click();
  const group = page.getByRole('group', { name: /^Horario \d+$/ }).last();
  await group.getByLabel('Fecha de inicio').fill(date);
  await group.getByLabel('Hora de inicio').fill(start);
  await group.getByLabel('Fecha de fin').fill(date);
  await group.getByLabel('Hora de fin').fill(end);
  await group.getByLabel('Zona horaria').fill(ZONE);
  await page.keyboard.press('Escape');
  await group.getByLabel('Cupo (personas)').fill('2');
}

function isCreate(response: Response): boolean {
  return (
    new URL(response.url()).pathname === '/v1/services' && response.request().method() === 'POST'
  );
}

async function save(page: Page): Promise<Response> {
  const response = page.waitForResponse(isCreate);
  await page.getByRole('button', { name: 'Guardar borrador' }).click();
  return response;
}

test.describe('HU015 Crear servicio contra el BFF web @integrado', () => {
  test('CA1, CA4–CA7: el profesional guarda el borrador una sola vez aunque se pierda la respuesta, y no aparece en el catálogo', async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const name = `Entrenamiento sintético HU015 ${Date.now()}`;
    const day = bogotaDate(2);
    const provider = await newPage(browser);
    const providerEmail = uniqueEmail('profesional');
    await register(provider, providerEmail, 'Profesional de servicios');
    await login(provider, providerEmail, /\/profesional\/inicio$/);

    await provider.locator('mat-sidenav [data-menu-item="service-create"]').click();
    await expect(provider).toHaveURL(/\/profesional\/servicios\/nuevo$/);
    await fillService(provider, name);
    await addInterval(provider, day, '09:00', '10:00');
    await addInterval(provider, day, '10:00', '11:00');

    // CA4: la primera solicitud llega al BFF real pero la respuesta se pierde en la
    // red. Los reintentos automáticos y el manual usan la misma Idempotency-Key.
    let lost: { key: string | null; status: number; serviceId: string } | null = null;
    await provider.route('**/v1/services', async (route) => {
      const original = await route.fetch();
      lost ??= {
        key: await route.request().headerValue('idempotency-key'),
        status: original.status(),
        serviceId: ((await original.json()) as { service_id: string }).service_id,
      };
      await route.abort('connectionfailed');
    });
    await provider.getByRole('button', { name: 'Guardar borrador' }).click();
    await expect(provider.getByTestId('service-error')).toContainText('No hay conexión', {
      timeout: 30_000,
    });
    await provider.unrouteAll({ behavior: 'wait' });
    expect(lost, 'la primera solicitud debía llegar al BFF').not.toBeNull();
    const first = lost!;
    expect(first.status, 'la primera solicitud debía crear el servicio').toBe(201);
    expect(first.key).toMatch(UUID);

    const created = await save(provider);
    expect(created.status()).toBe(201);
    expect(await created.request().headerValue('idempotency-key')).toBe(first.key);
    expect(await created.headerValue('idempotent-replayed')).toBe('true');
    const request = created.request().postDataJSON() as Record<string, unknown>;
    expect('provider_id' in request).toBe(false);
    expect(request['price']).toEqual({ amount: '85000.50', currency: 'COP', billing_unit: 'HOUR' });

    // CA1 y CA6: borrador versión 1 del profesional autenticado; instantes en UTC con su zona.
    const service = (await created.json()) as {
      service_id: string;
      provider_id: string;
      status: string;
      version: number;
      published_at: string | null;
      price: { amount: string };
      availability: { starts_at: string; ends_at: string; time_zone: string; capacity: number }[];
    };
    expect(service.service_id).toBe(first.serviceId);
    expect(service.provider_id).toMatch(UUID);
    expect(service.status).toBe('DRAFT');
    expect(service.version).toBe(1);
    expect(service.published_at).toBeNull();
    expect(service.availability).toEqual([
      { starts_at: `${day}T14:00:00Z`, ends_at: `${day}T15:00:00Z`, time_zone: ZONE, capacity: 2 },
      { starts_at: `${day}T15:00:00Z`, ends_at: `${day}T16:00:00Z`, time_zone: ZONE, capacity: 2 },
    ]);

    const result = provider.getByTestId('service-created');
    await expect(result).toContainText('Borrador guardado');
    await expect(provider.getByTestId('service-replayed')).toBeVisible();
    await expect(provider.getByTestId('service-status')).toHaveText('Borrador');
    await expect(provider.getByTestId('service-price')).toContainText('por hora');
    await expect(provider.getByTestId('service-intervals').getByRole('listitem')).toHaveCount(2);
    // CA7: tarifa de referencia, sin cobro ni contratación.
    await expect(result).toContainText('no genera cobros');

    // CA5: el borrador no aparece en el catálogo público del periodo que lo incluye.
    const athlete = await newPage(browser);
    const athleteEmail = uniqueEmail('deportista');
    await register(athlete, athleteEmail, 'Deportista');
    const athleteToken = await login(athlete, athleteEmail, /\/deportista\/inicio$/);
    const catalog = athlete.waitForResponse(
      (r) => new URL(r.url()).pathname === '/v1/services/availability',
    );
    await athlete.locator('mat-sidenav [data-menu-item="athlete-services"]').click();
    const availability = await catalog;
    expect(availability.status()).toBe(200);
    expect(new URL(availability.url()).searchParams.get('to')! > `${day}T`).toBe(true);
    const items = ((await availability.json()) as { items: { service_id: string }[] }).items;
    expect(items.map((item) => item.service_id)).not.toContain(service.service_id);
    await expect(athlete.getByText(name)).toHaveCount(0);

    // CA2: un deportista que intenta el comando directamente en el BFF es rechazado.
    const bffUrl = new URL(availability.url()).origin;
    const forbidden = await athlete.request.post(`${bffUrl}/v1/services`, {
      headers: {
        Authorization: `Bearer ${athleteToken}`,
        'Idempotency-Key': crypto.randomUUID(),
      },
      data: request,
    });
    expect(forbidden.status()).toBe(403);
    expect(((await forbidden.json()) as { code: string }).code).toBe('permission_required');
  });

  test('CA3 y CA6: horarios en el pasado o superpuestos se rechazan y se marcan en su horario', async ({
    browser,
  }) => {
    const provider = await newPage(browser);
    const email = uniqueEmail('profesional');
    await register(provider, email, 'Profesional de servicios');
    await login(provider, email, /\/profesional\/inicio$/);
    await provider.goto('/profesional/servicios/nuevo');
    await fillService(provider, 'Servicio sintético rechazado HU015');
    const day = bogotaDate(3);
    await addInterval(provider, day, '09:00', '10:00');
    await addInterval(provider, day, '09:30', '10:30');
    await addInterval(provider, '2020-01-15', '09:00', '10:00');

    const response = await save(provider);
    expect(response.status()).toBe(422);
    const body = (await response.json()) as {
      code: string;
      details: { field: string; issue: string }[];
    };
    expect(body.code).toBe('validation_error');
    expect(body.details).toEqual(
      containing([
        { field: 'availability[2].starts_at', issue: 'not_in_future' },
        { issue: 'overlapping_interval' },
      ]),
    );

    const errors = provider.getByTestId('service-errors');
    await expect(errors).toBeFocused();
    await expect(errors).toContainText('Horario 3 · Inicio: debe ser una fecha y hora futura.');
    await expect(errors).toContainText('se superpone con otro horario.');
    await expect(
      provider
        .getByRole('group', { name: 'Horario 3' })
        .getByText('debe ser una fecha y hora futura.'),
    ).not.toHaveCount(0);
    await expect(provider.getByTestId('service-created')).toHaveCount(0);
  });

  test('CA2: un organizador no entra a crear servicios', async ({ page }) => {
    const email = uniqueEmail('organizador');
    await register(page, email, 'Organizador de eventos');
    await login(page, email, /\/organizador\/inicio$/);

    await page.goto('/profesional/servicios/nuevo');

    await expect(page).toHaveURL(/\/acceso-no-autorizado$/);
  });
});

/**
 * Cada elemento esperado aparece en `actual` con al menos esas propiedades; el
 * backend puede informar más reglas (por ejemplo, la superposición en ambos lados).
 */
function containing(expected: readonly Record<string, string>[]) {
  return expect.arrayContaining(expected.map((item) => expect.objectContaining(item)));
}
