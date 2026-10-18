import { Page, expect, test } from '@playwright/test';

import { GET_CAPABILITIES_RESPONSES } from '../src/testing/bff-web/capabilities.fixtures';
import {
  PUBLISH_EVENT_RESPONSES,
  organizerEvent,
  organizerEvents,
} from '../src/testing/bff-web/publish-event.fixtures';
import { PublishEventsSimulation, simulatePublishEvents } from './support/publish-events-simulator';
import { SessionSimulation, login, sessionFor, simulateSession } from './support/session-simulator';

/**
 * HU024 Publicar eventos deportivos: el organizador revisa sus borradores y
 * publicados en `/organizador/eventos/publicacion` y publica un borrador
 * (ADR-033). El BFF está reemplazado por el simulador del contrato bff-web
 * 0.16.0. NO es E2E integrado.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function loginAs(
  page: Page,
  actorType: string,
  events = organizerEvents(3),
  configure: (session: SessionSimulation) => void = () => undefined,
): Promise<PublishEventsSimulation> {
  const session = await simulateSession(page, sessionFor(actorType));
  configure(session);
  const simulation = await simulatePublishEvents(page, events);
  await login(page);
  // El ingreso termina al llegar al inicio del actor: navegar antes perdería la sesión.
  await expect(page).toHaveURL(/\/(deportista|profesional|organizador)\/inicio$/);
  return simulation;
}

const items = (page: Page) => page.getByTestId('organizer-events-list').locator('li[data-event]');

async function openPublication(page: Page): Promise<void> {
  await page.locator('mat-sidenav [data-menu-item="event-publish"]').click();
  await expect(page).toHaveURL(/\/organizador\/eventos\/publicacion$/);
}

test.describe('HU024 Publicar eventos (simulador del contrato) @simulado', () => {
  test('CA1 y CA6: publica un borrador y lo muestra entre los publicados sin esperar la proyección', async ({
    page,
  }) => {
    const simulation = await loginAs(page, 'organizer');
    simulation.projectionDelayed = true;
    await openPublication(page);

    await expect(items(page)).toHaveCount(3);
    expect(new URL(simulation.listRequests[0].url()).searchParams.get('status')).toBe('DRAFT');
    await expect(items(page).first()).toContainText('Carrera 10K Bogotá');
    await expect(items(page).first()).toContainText('(America/Bogota)');

    await items(page).first().getByRole('link').click();
    const detail = page.getByTestId('event-publish-detail');
    await expect(detail.getByTestId('event-detail-status')).toHaveText('Borrador');
    await detail.getByRole('button', { name: 'Publicar' }).click();
    await expect(detail.getByTestId('event-publish-confirm')).toContainText(
      '¿Publicar «Carrera 10K Bogotá»?',
    );
    await detail.getByRole('button', { name: 'Confirmar publicación' }).click();

    await expect(detail.getByTestId('event-published')).toContainText('Evento publicado');
    await expect(detail.getByTestId('event-published-version')).toHaveText('2');
    await expect(detail.getByTestId('event-detail-status')).toHaveText('Publicado');
    const request = simulation.publishRequests[0];
    expect(request.postData()).toBeNull();
    expect(await request.headerValue('authorization')).toMatch(/^Bearer \S+$/);
    expect(await request.headerValue('idempotency-key')).toMatch(UUID);

    // Sale de los borradores y aparece entre los publicados con la respuesta del comando.
    await expect(items(page)).toHaveCount(2);
    await page.getByTestId('events-tab-published').click();
    await expect(items(page)).toHaveCount(1);
    await expect(items(page).first()).toContainText('Carrera 10K Bogotá');
    await expect(page.getByTestId('event-recently-published')).toBeVisible();
  });

  test('CA2: si el inicio ya pasó, advierte y muestra el requisito del 422 junto al campo', async ({
    page,
  }) => {
    const past = { ...organizerEvent(0), starts_at: '2026-01-10T12:00:00Z' };
    await loginAs(page, 'organizer', [past]);
    await openPublication(page);
    await items(page).first().getByRole('link').click();

    const detail = page.getByTestId('event-publish-detail');
    await expect(detail.getByTestId('event-starts-in-past')).toBeVisible();
    await detail.getByRole('button', { name: 'Publicar' }).click();
    await detail.getByRole('button', { name: 'Confirmar publicación' }).click();

    const summary = detail.getByTestId('event-publish-violations');
    await expect(summary).toBeFocused();
    await expect(summary.getByRole('listitem')).toHaveText([
      'Fecha y hora de inicio: debe ser una fecha futura.',
    ]);
    await expect(summary).toContainText('El evento sigue como borrador.');
    await expect(detail.getByTestId('event-detail-starts-at')).toContainText(
      'debe ser una fecha futura.',
    );
    await expect(detail.getByTestId('event-detail-status')).toHaveText('Borrador');
    await expect(items(page)).toHaveCount(1);
  });

  test('CA4: tras fallos transitorios reintenta con la misma clave y no publica dos veces', async ({
    page,
  }) => {
    const simulation = await loginAs(page, 'organizer');
    simulation.nextPublish.push(
      PUBLISH_EVENT_RESPONSES.upstreamUnavailable,
      PUBLISH_EVENT_RESPONSES.upstreamTimeout,
    );
    await openPublication(page);
    await items(page).first().getByRole('link').click();

    const detail = page.getByTestId('event-publish-detail');
    await detail.getByRole('button', { name: 'Publicar' }).click();
    await detail.getByRole('button', { name: 'Confirmar publicación' }).click();

    await expect(detail.getByTestId('event-published')).toBeVisible({ timeout: 10_000 });
    expect(simulation.publishRequests).toHaveLength(3);
    const keys = await Promise.all(
      simulation.publishRequests.map((request) => request.headerValue('idempotency-key')),
    );
    expect(new Set(keys).size).toBe(1);
  });

  test('CA6: pagina los borradores con el cursor del backend', async ({ page }) => {
    const simulation = await loginAs(page, 'organizer', organizerEvents(25));
    await openPublication(page);

    await expect(items(page)).toHaveCount(20);
    await expect(page.getByTestId('organizer-events-count')).toHaveText(
      'Eventos mostrados: 20. Hay más disponibles.',
    );
    await page.getByRole('button', { name: 'Cargar más' }).click();
    await expect(items(page)).toHaveCount(25);
    await expect(page.getByRole('button', { name: 'Cargar más' })).toHaveCount(0);
    expect(new URL(simulation.listRequests[1].url()).searchParams.get('cursor')).toBeTruthy();
  });

  test('CA3: un evento ajeno o inexistente se informa sin datos', async ({ page }) => {
    await loginAs(page, 'organizer');

    await page.goto('/organizador/eventos/publicacion/1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b');

    await expect(page.getByTestId('event-not-found')).toContainText('no te pertenece');
    await expect(page.getByTestId('event-detail')).toHaveCount(0);
  });

  test('CA6: sin events.publish la opción no aparece y la ruta directa se rechaza', async ({
    page,
  }) => {
    await loginAs(page, 'organizer', organizerEvents(1), (session) => {
      session.capabilities = {
        status: 200,
        body: { ...GET_CAPABILITIES_RESPONSES.organizer.body, permissions: ['events.create'] },
      };
    });
    await expect(page.locator('mat-sidenav [data-menu-item="event-publish"]')).toHaveCount(0);

    await page.goto('/organizador/eventos/publicacion');

    await expect(page).toHaveURL(/\/acceso-no-autorizado$/);
  });

  test('el deportista no entra a la publicación de eventos', async ({ page }) => {
    await loginAs(page, 'athlete');

    await page.goto('/organizador/eventos/publicacion');

    await expect(page).toHaveURL(/\/acceso-no-autorizado$/);
  });
});
