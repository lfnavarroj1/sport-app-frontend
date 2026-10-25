import { Page, expect, test } from '@playwright/test';

import { CREATE_SERVICE_RESPONSES } from '../src/testing/bff-web/create-service.fixtures';
import { ServicesSimulation, simulateServices } from './support/services-simulator';
import { login, sessionFor, simulateSession } from './support/session-simulator';

/**
 * HU015 Crear servicio: el profesional guarda un borrador en
 * `/profesional/servicios/nuevo`. El BFF está reemplazado por el simulador del
 * contrato bff-web 0.16.0 (ADR-027). NO es E2E integrado.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function loginAs(page: Page, actorType: string): Promise<ServicesSimulation> {
  await simulateSession(page, sessionFor(actorType));
  const simulation = await simulateServices(page);
  await login(page);
  // El ingreso termina al llegar al inicio del actor: navegar antes perdería la sesión.
  await expect(page).toHaveURL(/\/(deportista|profesional|organizador)\/inicio$/);
  return simulation;
}

async function choose(page: Page, label: string, option: string): Promise<void> {
  // Se pulsa el campo completo, como una persona: en una fila estrecha la etiqueta de un
  // `mat-select` vacío cubre el disparador y `mat-form-field` reenvía el clic al control.
  await page.locator('mat-form-field', { has: page.getByLabel(label) }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

async function fillService(page: Page, amount = '120000'): Promise<void> {
  await page.getByLabel('Nombre del servicio').fill('  Valoración deportiva inicial ');
  await page
    .getByLabel('Descripción')
    .fill('Valoración presencial para orientar el plan deportivo.');
  await choose(page, 'Categoría', 'Medicina deportiva');
  await choose(page, 'Modalidad', 'Presencial');
  await page.getByLabel('Valor').fill(amount);
  await choose(page, 'Unidad de cobro', 'Por sesión');
}

async function addInterval(
  page: Page,
  values: { start: [string, string]; end: [string, string]; capacity: string },
): Promise<void> {
  const groups = page.getByRole('group', { name: /^Horario \d+$/ });
  const count = await groups.count();
  await page.getByRole('button', { name: 'Agregar horario' }).click();
  // Se espera el horario nuevo: con `.last()` antes de que se pinte, el primer campo
  // caía en el horario anterior y el nuevo quedaba sin fecha de inicio.
  await expect(groups).toHaveCount(count + 1);
  const group = groups.nth(count);
  await group.getByLabel('Fecha de inicio').fill(values.start[0]);
  await group.getByLabel('Hora de inicio').fill(values.start[1]);
  await group.getByLabel('Fecha de fin').fill(values.end[0]);
  await group.getByLabel('Hora de fin').fill(values.end[1]);
  await group.getByLabel('Zona horaria').fill('America/Bogota');
  await page.keyboard.press('Escape');
  await group.getByLabel('Cupo (personas)').fill(values.capacity);
}

const saveButton = (page: Page) => page.getByRole('button', { name: 'Guardar borrador' });

test.describe('HU015 Crear servicio (simulador del contrato) @simulado', () => {
  test('CA1, CA5, CA6 y CA7: el profesional guarda el borrador con dos horarios contiguos', async ({
    page,
  }) => {
    const simulation = await loginAs(page, 'service_provider');
    await page.locator('mat-sidenav [data-menu-item="service-create"]').click();
    await expect(page).toHaveURL(/\/profesional\/servicios\/nuevo$/);
    await expect(page.getByTestId('interval-empty')).toBeVisible();

    await fillService(page, '120000,5');
    await expect(page.getByTestId('service-price-preview')).toContainText('120.000,5');
    await addInterval(page, {
      start: ['2026-11-20', '09:00'],
      end: ['2026-11-20', '10:00'],
      capacity: '1',
    });
    await addInterval(page, {
      start: ['2026-11-20', '10:00'],
      end: ['2026-11-20', '11:00'],
      capacity: '3',
    });
    await saveButton(page).click();

    const created = page.getByTestId('service-created');
    await expect(created).toContainText('Borrador guardado');
    await expect(page.getByTestId('service-status')).toHaveText('Borrador');
    await expect(page.getByTestId('service-price')).toContainText('por sesión');
    await expect(page.getByTestId('service-intervals').getByRole('listitem')).toHaveCount(2);
    await expect(page.getByTestId('service-intervals')).toContainText('America/Bogota');
    await expect(created).toContainText('no aparecen en el catálogo de servicios');
    await expect(created).toContainText('no genera cobros');

    expect(simulation.requests).toHaveLength(1);
    const request = simulation.requests[0];
    expect(await request.headerValue('authorization')).toMatch(/^Bearer \S+$/);
    expect(await request.headerValue('idempotency-key')).toMatch(UUID);
    expect(request.postDataJSON()).toEqual({
      name: 'Valoración deportiva inicial',
      description: 'Valoración presencial para orientar el plan deportivo.',
      category: 'SPORTS_MEDICINE',
      modality: 'IN_PERSON',
      price: { amount: '120000.5', currency: 'COP', billing_unit: 'SESSION' },
      availability: [
        {
          starts_at: '2026-11-20T09:00:00-05:00',
          ends_at: '2026-11-20T10:00:00-05:00',
          time_zone: 'America/Bogota',
          capacity: 1,
        },
        {
          starts_at: '2026-11-20T10:00:00-05:00',
          ends_at: '2026-11-20T11:00:00-05:00',
          time_zone: 'America/Bogota',
          capacity: 3,
        },
      ],
    });
  });

  test('CA6 y CA7: un servicio gratuito sin disponibilidad se guarda sin availability', async ({
    page,
  }) => {
    const simulation = await loginAs(page, 'service_provider');
    await page.goto('/profesional/servicios/nuevo');
    await fillService(page, '0');
    await expect(page.getByTestId('service-price-preview')).toContainText('servicio gratuito');
    await saveButton(page).click();

    await expect(page.getByTestId('service-created')).toBeVisible();
    await expect(page.getByTestId('service-no-intervals')).toBeVisible();
    const body = simulation.requests[0].postDataJSON() as Record<string, unknown>;
    expect(body['price']).toEqual({ amount: '0', currency: 'COP', billing_unit: 'SESSION' });
    expect('availability' in body).toBe(false);
  });

  test('CA3: un importe con tres decimales no se envía', async ({ page }) => {
    const simulation = await loginAs(page, 'service_provider');
    await page.goto('/profesional/servicios/nuevo');
    await fillService(page, '10,123');
    await saveButton(page).click();

    await expect(page.getByLabel('Valor')).toBeFocused();
    await expect(page.getByText('Usa un valor de hasta 9 cifras y 2 decimales')).toBeVisible();
    expect(simulation.requests).toHaveLength(0);
  });

  test('CA3 y CA6: las reglas del backend se listan y se marcan en el horario', async ({
    page,
  }) => {
    const simulation = await loginAs(page, 'service_provider');
    simulation.next.push(CREATE_SERVICE_RESPONSES.validationError);
    await page.goto('/profesional/servicios/nuevo');
    await fillService(page);
    await addInterval(page, {
      start: ['2026-11-20', '09:00'],
      end: ['2026-11-20', '10:00'],
      capacity: '1',
    });
    await addInterval(page, {
      start: ['2026-11-20', '09:30'],
      end: ['2026-11-21', '12:00'],
      capacity: '1',
    });
    await saveButton(page).click();

    const errors = page.getByTestId('service-errors');
    await expect(errors).toBeFocused();
    await expect(errors.getByRole('listitem')).toHaveText([
      'Valor: admite como máximo 2 decimales.',
      'Horario 1 · Zona horaria: la hora no existe o no coincide con la zona horaria en esa fecha.',
      'Horario 2 · Inicio: se superpone con otro horario.',
      'Horario 2 · Fin: está fuera del rango permitido.',
    ]);
    await expect(
      page.getByRole('group', { name: 'Horario 2' }).getByText('se superpone con otro horario.'),
    ).toHaveCount(2);
    await expect(page.getByTestId('service-created')).toHaveCount(0);
    expect(simulation.requests).toHaveLength(1);
  });

  test('CA4: ante 503 reintenta solo con la misma clave y confirma un único borrador', async ({
    page,
  }) => {
    const simulation = await loginAs(page, 'service_provider');
    simulation.next.push(
      CREATE_SERVICE_RESPONSES.upstreamUnavailable,
      CREATE_SERVICE_RESPONSES.upstreamTimeout,
    );
    await page.goto('/profesional/servicios/nuevo');
    await fillService(page);
    await saveButton(page).click();

    await expect(page.getByTestId('service-retrying')).toContainText('Reintentando');
    await expect(page.getByTestId('service-created')).toBeVisible({ timeout: 15_000 });
    expect(simulation.requests).toHaveLength(3);
    const keys = await Promise.all(
      simulation.requests.map((request) => request.headerValue('idempotency-key')),
    );
    expect(new Set(keys).size).toBe(1);
  });

  test('CA4: agotados los reintentos, volver a guardar no duplica el servicio', async ({
    page,
  }) => {
    const simulation = await loginAs(page, 'service_provider');
    simulation.next.push(...Array(4).fill(CREATE_SERVICE_RESPONSES.upstreamUnavailable));
    await page.goto('/profesional/servicios/nuevo');
    await fillService(page);
    await saveButton(page).click();

    const error = page.getByTestId('service-error');
    await expect(error).toContainText('no se creará otro', { timeout: 15_000 });
    await expect(error).toContainText('Código de referencia');
    expect(simulation.requests).toHaveLength(4);

    await saveButton(page).click();
    await expect(page.getByTestId('service-created')).toBeVisible();
    expect(await simulation.requests[4].headerValue('idempotency-key')).toBe(
      await simulation.requests[0].headerValue('idempotency-key'),
    );
  });

  test('CA4: una clave reutilizada con otros datos se explica sin crear nada', async ({ page }) => {
    const simulation = await loginAs(page, 'service_provider');
    simulation.next.push(CREATE_SERVICE_RESPONSES.idempotencyKeyReused);
    await page.goto('/profesional/servicios/nuevo');
    await fillService(page);
    await saveButton(page).click();

    await expect(page.getByTestId('service-error')).toContainText('vuelve a guardar el borrador');
    await expect(page.getByTestId('service-created')).toHaveCount(0);
  });

  test('CA2: sin el permiso el BFF responde 403 y no se muestra ningún borrador', async ({
    page,
  }) => {
    const simulation = await loginAs(page, 'service_provider');
    simulation.next.push(CREATE_SERVICE_RESPONSES.permissionRequired);
    await page.goto('/profesional/servicios/nuevo');
    await fillService(page);
    await saveButton(page).click();

    await expect(page.getByTestId('service-error')).toContainText(
      'No tienes permiso para realizar esta acción.',
    );
    await expect(page.getByTestId('service-created')).toHaveCount(0);
  });

  test('CA2: un organizador no entra a crear servicios', async ({ page }) => {
    await loginAs(page, 'organizer');

    await page.goto('/profesional/servicios/nuevo');

    await expect(page).toHaveURL(/\/acceso-no-autorizado$/);
  });
});
