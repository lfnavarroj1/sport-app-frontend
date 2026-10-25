import { Page, expect, test } from '@playwright/test';

import {
  DRAFT_WITHOUT_FEE,
  PUBLISHED_FREE,
  PUBLISHED_WITH_REGISTRATIONS,
  PUT_EVENT_FEE_RESPONSES,
} from '../src/testing/bff-web/event-pricing.fixtures';
import { EventPricingSimulation, simulateEventPricing } from './support/event-pricing-simulator';
import { login, sessionFor, simulateSession } from './support/session-simulator';

/**
 * HU025 Asignar tarifas al evento: el organizador asigna o retira la tarifa de
 * sus eventos en `/organizador/eventos/tarifas` (ADR-040). El BFF está
 * reemplazado por el simulador del contrato bff-web 0.26.0. NO es E2E integrado.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function loginAs(
  page: Page,
  actorType: string,
  events = [{ ...DRAFT_WITHOUT_FEE }, { ...PUBLISHED_WITH_REGISTRATIONS }, { ...PUBLISHED_FREE }],
): Promise<EventPricingSimulation> {
  await simulateSession(page, sessionFor(actorType));
  const simulation = await simulateEventPricing(page, events);
  await login(page);
  // El ingreso termina al llegar al inicio del actor: navegar antes perdería la sesión.
  await expect(page).toHaveURL(/\/(deportista|profesional|organizador)\/inicio$/);
  return simulation;
}

const items = (page: Page) => page.getByTestId('pricing-events-list').locator('li[data-event]');
const editor = (page: Page) => page.getByTestId('event-fee-editor');

async function openPricing(page: Page): Promise<void> {
  await page.locator('mat-sidenav [data-menu-item="event-pricing"]').click();
  await expect(page).toHaveURL(/\/organizador\/eventos\/tarifas$/);
}

async function openEvent(page: Page, index: number): Promise<void> {
  await items(page).nth(index).getByRole('link').click();
  await expect(editor(page)).toBeVisible();
}

test.describe('HU025 Tarifas de eventos (simulador del contrato) @simulado', () => {
  test('lista los eventos propios con su tarifa en COP, gratuito o sin tarifa', async ({
    page,
  }) => {
    const simulation = await loginAs(page, 'organizer');
    await openPricing(page);

    await expect(items(page)).toHaveCount(3);
    expect(new URL(simulation.listRequests[0].url()).searchParams.get('status')).toBeNull();
    await expect(items(page).nth(0).getByTestId('pricing-event-fee')).toHaveText('Sin tarifa');
    await expect(items(page).nth(1).getByTestId('pricing-event-fee')).toContainText('85.000');
    await expect(items(page).nth(2).getByTestId('pricing-event-fee')).toHaveText('Gratuito');
    await expect(items(page).nth(1).getByTestId('pricing-event-registrations')).toContainText('3');
    await expect(page.getByTestId('fee-detail-placeholder')).toBeVisible();
  });

  test('CA1, CA4 y CA5: asigna una tarifa con inscritos, ve el aviso y la versión nueva', async ({
    page,
  }) => {
    const simulation = await loginAs(page, 'organizer');
    await openPricing(page);
    await openEvent(page, 1);

    await expect(editor(page).getByTestId('fee-registrations-warning')).toContainText(
      'Las inscripciones existentes conservan su tarifa',
    );
    await editor(page).getByLabel('Valor de la tarifa').fill('90.000,50');
    await expect(editor(page).getByTestId('fee-preview')).toContainText('90.000,5');
    await editor(page).getByRole('button', { name: 'Guardar tarifa' }).click();
    await expect(editor(page).getByTestId('fee-confirm')).toContainText('«Evento sintético 2»');
    await editor(page).getByRole('button', { name: 'Confirmar' }).click();

    const result = editor(page).getByTestId('fee-result');
    await expect(result).toContainText('Tarifa asignada');
    await expect(result.getByTestId('fee-result-version')).toHaveText('3');
    await expect(result.getByTestId('fee-result-registrations')).toHaveText('3');
    await expect(result).toContainText('no genera cobros');
    await expect(items(page).nth(1).getByTestId('pricing-event-fee')).toContainText('90.000,5');

    const request = simulation.feeRequests[0];
    expect(request.method()).toBe('PUT');
    expect(request.postDataJSON()).toEqual({
      amount: '90000.50',
      currency: 'COP',
      expected_version: 2,
    });
    expect(await request.headerValue('authorization')).toMatch(/^Bearer \S+$/);
    expect(await request.headerValue('idempotency-key')).toMatch(UUID);
  });

  test('asigna 0 como gratuito y luego retira la tarifa', async ({ page }) => {
    const simulation = await loginAs(page, 'organizer');
    await openPricing(page);
    await openEvent(page, 0);

    await editor(page).getByLabel('Valor de la tarifa').fill('0');
    await expect(editor(page).getByTestId('fee-preview')).toContainText('gratuito');
    await editor(page).getByRole('button', { name: 'Guardar tarifa' }).click();
    await editor(page).getByRole('button', { name: 'Confirmar' }).click();
    await expect(editor(page).getByTestId('fee-result-fee')).toHaveText('Gratuito');
    await expect(items(page).nth(0).getByTestId('pricing-event-fee')).toHaveText('Gratuito');

    await editor(page).getByRole('button', { name: 'Retirar tarifa' }).click();
    await expect(editor(page).getByTestId('fee-confirm')).toContainText('¿Retirar la tarifa');
    await editor(page).getByRole('button', { name: 'Confirmar' }).click();
    await expect(editor(page).getByTestId('fee-result')).toContainText('Tarifa retirada');
    await expect(items(page).nth(0).getByTestId('pricing-event-fee')).toHaveText('Sin tarifa');

    const remove = simulation.feeRequests[1];
    expect(remove.method()).toBe('DELETE');
    expect(new URL(remove.url()).searchParams.get('expected_version')).toBe('2');
  });

  test('CA2: valida el formato en el cliente y marca el 422 del backend junto al campo', async ({
    page,
  }) => {
    const simulation = await loginAs(page, 'organizer');
    await openPricing(page);
    await openEvent(page, 1);

    await editor(page).getByLabel('Valor de la tarifa').fill('85000,505');
    await editor(page).getByRole('button', { name: 'Guardar tarifa' }).click();
    await expect(editor(page).getByTestId('fee-amount-error')).toContainText('dos decimales');
    expect(simulation.feeRequests).toHaveLength(0);

    simulation.nextFee.push(PUT_EVENT_FEE_RESPONSES.eventAlreadyStarted);
    await editor(page).getByLabel('Valor de la tarifa').fill('90000');
    await editor(page).getByRole('button', { name: 'Guardar tarifa' }).click();
    await editor(page).getByRole('button', { name: 'Confirmar' }).click();
    await expect(editor(page).getByTestId('fee-violations')).toContainText('ya comenzó');
    await expect(items(page).nth(1).getByTestId('pricing-event-fee')).toContainText('85.000');
  });

  test('CA3: una versión obsoleta ofrece actualizar el evento y reintentar', async ({ page }) => {
    const simulation = await loginAs(page, 'organizer');
    await openPricing(page);
    await openEvent(page, 1);

    // Otra pestaña cambió la tarifa: el estado de escritura ya está en la versión 3.
    simulation.events[1] = {
      ...simulation.events[1],
      version: 3,
      fee: { amount: '87000.00', currency: 'COP' },
    };
    await editor(page).getByLabel('Valor de la tarifa').fill('90000');
    await editor(page).getByRole('button', { name: 'Guardar tarifa' }).click();
    await editor(page).getByRole('button', { name: 'Confirmar' }).click();
    await expect(editor(page).getByTestId('fee-conflict')).toContainText('versión vigente: 3');

    await editor(page).getByRole('button', { name: 'Actualizar evento' }).click();
    await expect(editor(page).getByTestId('fee-version')).toHaveText('3');
    await expect(editor(page).getByLabel('Valor de la tarifa')).toHaveValue('87000');

    await editor(page).getByLabel('Valor de la tarifa').fill('90000');
    await editor(page).getByRole('button', { name: 'Guardar tarifa' }).click();
    await editor(page).getByRole('button', { name: 'Confirmar' }).click();
    await expect(editor(page).getByTestId('fee-result-version')).toHaveText('4');
  });

  test('CA5: un fallo transitorio se reintenta con la misma clave sin aplicar dos veces', async ({
    page,
  }) => {
    const simulation = await loginAs(page, 'organizer');
    await openPricing(page);
    await openEvent(page, 1);

    simulation.nextFee.push(
      PUT_EVENT_FEE_RESPONSES.upstreamUnavailable,
      PUT_EVENT_FEE_RESPONSES.upstreamUnavailable,
      PUT_EVENT_FEE_RESPONSES.upstreamUnavailable,
      PUT_EVENT_FEE_RESPONSES.upstreamUnavailable,
    );
    await editor(page).getByLabel('Valor de la tarifa').fill('90000');
    await editor(page).getByRole('button', { name: 'Guardar tarifa' }).click();
    await editor(page).getByRole('button', { name: 'Confirmar' }).click();
    await expect(editor(page).getByTestId('fee-error')).toContainText('no se aplicará dos veces', {
      timeout: 15_000,
    });

    await editor(page).getByRole('button', { name: 'Confirmar' }).click();
    await expect(editor(page).getByTestId('fee-result-version')).toHaveText('3');
    const keys = await Promise.all(
      simulation.feeRequests.map((request) => request.headerValue('idempotency-key')),
    );
    expect(keys).toHaveLength(5);
    expect(new Set(keys).size).toBe(1);
  });

  test('un evento ajeno o inexistente se informa sin datos', async ({ page }) => {
    await loginAs(page, 'organizer');
    await openPricing(page);
    await expect(items(page)).toHaveCount(3);
    await page.goto('/organizador/eventos/tarifas/00000000-0000-4000-8000-000000000000');

    await expect(page.getByTestId('fee-event-not-found')).toContainText('no te pertenece');
  });

  test('sin eventos propios muestra el vacío', async ({ page }) => {
    await loginAs(page, 'organizer', []);
    await openPricing(page);

    await expect(page.getByTestId('state-empty')).toContainText('Aún no tienes eventos');
  });

  test('otro actor no accede a las tarifas', async ({ page }) => {
    await loginAs(page, 'service_provider');
    await page.goto('/organizador/eventos/tarifas');

    await expect(page).not.toHaveURL(/\/organizador\/eventos\/tarifas$/);
  });
});
