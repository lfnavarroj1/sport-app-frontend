import { Page, expect, test } from '@playwright/test';

import { CREATE_EVENT_RESPONSES } from '../src/testing/bff-web/create-event.fixtures';
import { EventsSimulation, simulateEvents } from './support/events-simulator';
import { login, sessionFor, simulateSession } from './support/session-simulator';

/**
 * HU021 Crear evento masivo: el organizador crea un borrador en
 * `/organizador/eventos/nuevo`. El BFF está reemplazado por el simulador del
 * contrato bff-web 0.10.0 (ADR-028). NO es E2E integrado.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function loginAs(page: Page, actorType: string): Promise<EventsSimulation> {
  await simulateSession(page, sessionFor(actorType));
  const simulation = await simulateEvents(page);
  await login(page);
  // El ingreso termina al llegar al inicio del actor: navegar antes perdería la sesión.
  await expect(page).toHaveURL(/\/(deportista|profesional|organizador)\/inicio$/);
  return simulation;
}

async function fillEvent(page: Page): Promise<void> {
  await page.getByLabel('Nombre del evento').fill('  Carrera 10K Bogotá ');
  await page.getByLabel('Disciplina').fill('Running');
  await page
    .getByLabel('Descripción')
    .fill('Carrera recreativa de diez kilómetros para corredores aficionados.');
  await page.getByLabel('Nombre del lugar').fill('Parque Metropolitano Simón Bolívar');
  await page.getByLabel('Dirección').fill('Avenida Calle 63 # 60-50');
  await page.getByLabel('Ciudad').fill('Bogotá');
  await page.getByLabel('País (código)').fill('co');
  await page.getByLabel('Fecha de inicio').fill('2026-11-15');
  await page.getByLabel('Hora de inicio').fill('07:00');
  await page.getByLabel('Zona horaria').fill('America/Bogota');
  await page.keyboard.press('Escape');
  await page.getByLabel('Duración (min)').fill('180');
  await page.getByLabel('Capacidad (personas)').fill('5000');
}

const createButton = (page: Page) => page.getByRole('button', { name: 'Crear borrador' });

test.describe('HU021 Crear evento masivo (simulador del contrato) @simulado', () => {
  test('CA1 y CA5: el organizador crea el borrador y ve la respuesta del comando', async ({
    page,
  }) => {
    const simulation = await loginAs(page, 'organizer');
    await page.locator('mat-sidenav [data-menu-item="event-create"]').click();
    await expect(page).toHaveURL(/\/organizador\/eventos\/nuevo$/);
    await expect(page.getByTestId('event-country-name')).toBeVisible();

    await fillEvent(page);
    await expect(page.getByTestId('event-country-name')).toHaveText('Colombia');
    await createButton(page).click();

    const created = page.getByTestId('event-created');
    await expect(created).toContainText('Borrador creado');
    await expect(created).toContainText(
      'El evento «Carrera 10K Bogotá» quedó guardado como borrador.',
    );
    await expect(page.getByTestId('event-starts-at')).toContainText('15 de noviembre de 2026');
    await expect(page.getByTestId('event-starts-at')).toContainText('7:00');
    await expect(page.getByTestId('event-ends-at')).toContainText('10:00');
    await expect(created).toContainText('no aparecen en el catálogo');

    expect(simulation.requests).toHaveLength(1);
    const request = simulation.requests[0];
    expect(await request.headerValue('authorization')).toMatch(/^Bearer \S+$/);
    expect(await request.headerValue('idempotency-key')).toMatch(UUID);
    expect(request.postDataJSON()).toEqual({
      name: 'Carrera 10K Bogotá',
      description: 'Carrera recreativa de diez kilómetros para corredores aficionados.',
      discipline: 'Running',
      location: {
        name: 'Parque Metropolitano Simón Bolívar',
        address: 'Avenida Calle 63 # 60-50',
        city: 'Bogotá',
        country_code: 'CO',
      },
      starts_at: '2026-11-15T07:00:00-05:00',
      time_zone: 'America/Bogota',
      duration_minutes: 180,
      capacity: 5000,
    });
  });

  test('CA7: ante 503 reintenta solo con la misma clave y confirma un único borrador', async ({
    page,
  }) => {
    const simulation = await loginAs(page, 'organizer');
    simulation.next.push(
      CREATE_EVENT_RESPONSES.upstreamUnavailable,
      CREATE_EVENT_RESPONSES.upstreamTimeout,
    );
    await page.goto('/organizador/eventos/nuevo');
    await fillEvent(page);
    await createButton(page).click();

    await expect(page.getByTestId('event-retrying')).toContainText('Reintentando');
    await expect(page.getByTestId('event-created')).toBeVisible({ timeout: 15_000 });
    expect(simulation.requests).toHaveLength(3);
    const keys = await Promise.all(
      simulation.requests.map((request) => request.headerValue('idempotency-key')),
    );
    expect(new Set(keys).size).toBe(1);
  });

  test('CA4 y CA7: agotados los reintentos, volver a crear no duplica el evento', async ({
    page,
  }) => {
    const simulation = await loginAs(page, 'organizer');
    simulation.next.push(...Array(4).fill(CREATE_EVENT_RESPONSES.upstreamUnavailable));
    await page.goto('/organizador/eventos/nuevo');
    await fillEvent(page);
    await createButton(page).click();

    const error = page.getByTestId('event-error');
    await expect(error).toContainText('no se creará otro', { timeout: 15_000 });
    await expect(error).toContainText('Código de referencia');
    expect(simulation.requests).toHaveLength(4);

    await createButton(page).click();
    await expect(page.getByTestId('event-created')).toBeVisible();
    expect(await simulation.requests[4].headerValue('idempotency-key')).toBe(
      await simulation.requests[0].headerValue('idempotency-key'),
    );
  });

  test('CA3: las reglas incumplidas se listan y se marcan en sus campos', async ({ page }) => {
    const simulation = await loginAs(page, 'organizer');
    simulation.next.push(CREATE_EVENT_RESPONSES.validationError);
    await page.goto('/organizador/eventos/nuevo');
    await fillEvent(page);
    await createButton(page).click();

    const errors = page.getByTestId('event-errors');
    await expect(errors).toBeFocused();
    await expect(errors.getByRole('listitem')).toHaveText([
      'Fecha y hora de inicio: debe ser una fecha futura.',
      'Zona horaria: la hora no existe o no coincide con la zona horaria en esa fecha.',
      'País (código): el valor no es válido.',
      'Capacidad (personas): está fuera del rango permitido.',
    ]);
    await expect(page.getByTestId('event-created')).toHaveCount(0);
    expect(simulation.requests).toHaveLength(1);
  });

  test('CA4: una clave reutilizada con otros datos se explica sin crear nada', async ({ page }) => {
    const simulation = await loginAs(page, 'organizer');
    simulation.next.push(CREATE_EVENT_RESPONSES.idempotencyKeyReused);
    await page.goto('/organizador/eventos/nuevo');
    await fillEvent(page);
    await createButton(page).click();

    await expect(page.getByTestId('event-error')).toContainText('vuelve a crear el borrador');
    await expect(page.getByTestId('event-created')).toHaveCount(0);
  });

  test('CA2: un deportista no entra a crear eventos', async ({ page }) => {
    await loginAs(page, 'athlete');

    await page.goto('/organizador/eventos/nuevo');

    await expect(page).toHaveURL(/\/acceso-no-autorizado$/);
  });
});
