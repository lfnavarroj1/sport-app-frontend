import { Page, expect, test } from '@playwright/test';

import { GET_CAPABILITIES_RESPONSES } from '../src/testing/bff-web/capabilities.fixtures';
import {
  PUBLISH_SERVICE_RESPONSES,
  ownService,
  ownServices,
} from '../src/testing/bff-web/publish-service.fixtures';
import {
  PublishServicesSimulation,
  simulatePublishServices,
} from './support/publish-services-simulator';
import { SessionSimulation, login, sessionFor, simulateSession } from './support/session-simulator';

/**
 * HU019 Publicar servicios: el profesional revisa sus borradores y publicados en
 * `/profesional/servicios/publicacion` y publica un borrador (ADR-027). El BFF
 * está reemplazado por el simulador del contrato bff-web 0.16.0. NO es E2E
 * integrado.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function loginAs(
  page: Page,
  actorType: string,
  services = ownServices(3),
  configure: (session: SessionSimulation) => void = () => undefined,
): Promise<PublishServicesSimulation> {
  const session = await simulateSession(page, sessionFor(actorType));
  configure(session);
  const simulation = await simulatePublishServices(page, services);
  await login(page);
  // El ingreso termina al llegar al inicio del actor: navegar antes perdería la sesión.
  await expect(page).toHaveURL(/\/(deportista|profesional|organizador)\/inicio$/);
  return simulation;
}

const items = (page: Page) => page.getByTestId('own-services-list').locator('li[data-service]');

async function openPublication(page: Page): Promise<void> {
  await page.locator('mat-sidenav [data-menu-item="service-publish"]').click();
  await expect(page).toHaveURL(/\/profesional\/servicios\/publicacion$/);
}

test.describe('HU019 Publicar servicios (simulador del contrato) @simulado', () => {
  test('CA1: revisa los requisitos, publica tras confirmar y el servicio pasa a publicados', async ({
    page,
  }) => {
    const simulation = await loginAs(page, 'service_provider');
    await openPublication(page);

    await expect(items(page)).toHaveCount(3);
    expect(new URL(simulation.listRequests[0].url()).searchParams.get('status')).toBe('DRAFT');
    await expect(items(page).first()).toContainText('Valoración deportiva inicial');
    await expect(items(page).first()).toContainText('Horarios futuros: 1');

    await items(page).first().getByRole('link').click();
    const detail = page.getByTestId('service-publish-detail');
    await expect(detail.getByTestId('service-detail-status')).toHaveText('Borrador');
    await expect(detail.getByTestId('requirement-price')).toContainText('(COP)');
    await expect(detail.getByTestId('requirement-billing-unit')).toHaveText('Por sesión');
    await expect(detail.getByTestId('requirement-availability')).toContainText(
      'Horarios futuros: 1',
    );
    await expect(detail.getByTestId('service-requirements')).toContainText(
      'Publicar no confirma pagos',
    );

    await detail.getByRole('button', { name: 'Publicar' }).click();
    await expect(detail.getByTestId('service-publish-confirm')).toContainText(
      '¿Publicar «Valoración deportiva inicial»?',
    );
    await detail.getByRole('button', { name: 'Sí, publicar' }).click();

    await expect(detail.getByTestId('service-published')).toContainText('Servicio publicado');
    await expect(detail.getByTestId('service-published-version')).toHaveText('2');
    await expect(detail.getByTestId('service-detail-status')).toHaveText('Publicado');
    expect(simulation.publishRequests).toHaveLength(1);
    const publish = simulation.publishRequests[0];
    expect(publish.postData()).toBeNull();
    expect(await publish.headerValue('idempotency-key')).toMatch(UUID);
    expect(await publish.headerValue('authorization')).toMatch(/^Bearer \S+$/);

    // Sin proyección: la lista vuelve a consultar el backend y el servicio ya no es borrador.
    await expect(items(page)).toHaveCount(2);
    await page.getByTestId('services-tab-published').click();
    await expect(items(page)).toHaveCount(1);
    await expect(items(page).first()).toContainText('Publicado el');
  });

  test('CA2: sin horarios futuros advierte y el 422 enumera el requisito; sigue como borrador', async ({
    page,
  }) => {
    const incomplete = ownService(3, 'DRAFT', false);
    const simulation = await loginAs(page, 'service_provider', [incomplete]);
    await page.goto(`/profesional/servicios/publicacion/${incomplete.service_id}`);

    const detail = page.getByTestId('service-publish-detail');
    await expect(detail.getByTestId('requirement-availability')).toContainText(
      'Sin horarios futuros.',
    );
    await expect(detail.getByTestId('service-no-upcoming')).toBeVisible();
    await detail.getByRole('button', { name: 'Publicar' }).click();
    await detail.getByRole('button', { name: 'Sí, publicar' }).click();

    const violations = detail.getByTestId('service-publish-violations');
    await expect(violations).toBeFocused();
    await expect(violations.getByRole('listitem')).toHaveText([
      'Disponibilidad futura: necesita al menos un horario futuro.',
    ]);
    await expect(violations).toContainText('sigue como borrador');
    await expect(detail.getByTestId('requirement-availability')).toContainText(
      'necesita al menos un horario futuro.',
    );
    await expect(detail.getByTestId('service-detail-status')).toHaveText('Borrador');
    expect(simulation.services[0].status).toBe('DRAFT');
  });

  test('CA2: varios requisitos faltantes se marcan junto a cada fila', async ({ page }) => {
    const simulation = await loginAs(page, 'service_provider', ownServices(1));
    simulation.nextPublish.push(PUBLISH_SERVICE_RESPONSES.requirementsMissing);
    await page.goto(`/profesional/servicios/publicacion/${ownService(0).service_id}`);

    const detail = page.getByTestId('service-publish-detail');
    await detail.getByRole('button', { name: 'Publicar' }).click();
    await detail.getByRole('button', { name: 'Sí, publicar' }).click();

    await expect(detail.getByTestId('service-publish-violations').getByRole('listitem')).toHaveText(
      [
        'Descripción: la longitud no es válida.',
        'Tarifa en COP: está fuera del rango permitido.',
        'Disponibilidad futura: necesita al menos un horario futuro.',
      ],
    );
    await expect(detail.getByTestId('service-field-violation')).toHaveCount(3);
  });

  test('CA4: tras una respuesta perdida y un 503 reintenta con la misma clave y publica una vez', async ({
    page,
  }) => {
    const simulation = await loginAs(page, 'service_provider', ownServices(1));
    // La primera solicitud publica, pero su respuesta se pierde; la segunda recibe 503.
    simulation.loseNextResponse = true;
    simulation.nextPublish.push(PUBLISH_SERVICE_RESPONSES.upstreamUnavailable);
    await page.goto(`/profesional/servicios/publicacion/${ownService(0).service_id}`);
    const detail = page.getByTestId('service-publish-detail');
    await detail.getByRole('button', { name: 'Publicar' }).click();
    await detail.getByRole('button', { name: 'Sí, publicar' }).click();

    await expect(detail.getByTestId('service-published')).toBeVisible({ timeout: 15_000 });
    await expect(detail.getByTestId('service-publish-replayed')).toBeVisible();
    const keys = await Promise.all(
      simulation.publishRequests.map((request) => request.headerValue('idempotency-key')),
    );
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(1);
    expect(simulation.services[0].version).toBe(2);
  });

  test('CA4: agotados los reintentos, volver a publicar usa la misma clave', async ({ page }) => {
    const simulation = await loginAs(page, 'service_provider', ownServices(1));
    simulation.nextPublish.push(...Array(4).fill(PUBLISH_SERVICE_RESPONSES.upstreamUnavailable));
    await page.goto(`/profesional/servicios/publicacion/${ownService(0).service_id}`);
    const detail = page.getByTestId('service-publish-detail');
    await detail.getByRole('button', { name: 'Publicar' }).click();
    await detail.getByRole('button', { name: 'Sí, publicar' }).click();

    const error = detail.getByTestId('service-publish-error');
    await expect(error).toContainText('no se publicará dos veces', { timeout: 15_000 });
    await expect(error).toContainText('Código de referencia');
    expect(simulation.publishRequests).toHaveLength(4);

    await detail.getByRole('button', { name: 'Sí, publicar' }).click();
    await expect(detail.getByTestId('service-published')).toBeVisible();
    expect(await simulation.publishRequests[4].headerValue('idempotency-key')).toBe(
      await simulation.publishRequests[0].headerValue('idempotency-key'),
    );
  });

  test('CA4: un servicio ya publicado no ofrece publicar otra vez', async ({ page }) => {
    const published = ownService(5, 'PUBLISHED');
    await loginAs(page, 'service_provider', [published]);
    await page.goto(`/profesional/servicios/publicacion/${published.service_id}`);

    const detail = page.getByTestId('service-publish-detail');
    await expect(detail.getByTestId('service-detail-status')).toHaveText('Publicado');
    await expect(detail.getByTestId('service-already-published')).toBeVisible();
    await expect(detail.getByRole('button', { name: 'Publicar' })).toHaveCount(0);
  });

  test('CA3: un servicio ajeno o inexistente se informa sin datos', async ({ page }) => {
    await loginAs(page, 'service_provider');

    await page.goto('/profesional/servicios/publicacion/1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b');

    await expect(page.getByTestId('service-not-found')).toContainText('no existe o no es tuyo');
    await expect(page.getByTestId('service-detail')).toHaveCount(0);
  });

  test('pagina los borradores con el cursor del backend', async ({ page }) => {
    const simulation = await loginAs(page, 'service_provider', ownServices(25));
    await openPublication(page);

    await expect(items(page)).toHaveCount(20);
    await page.getByRole('button', { name: 'Cargar más' }).click();
    await expect(items(page)).toHaveCount(25);
    await expect(page.getByRole('button', { name: 'Cargar más' })).toHaveCount(0);
    expect(new URL(simulation.listRequests[1].url()).searchParams.get('cursor')).toBeTruthy();
  });

  test('sin services.publish la opción no aparece y la ruta directa se rechaza', async ({
    page,
  }) => {
    await loginAs(page, 'service_provider', ownServices(1), (session) => {
      session.capabilities = {
        status: 200,
        body: {
          ...GET_CAPABILITIES_RESPONSES.serviceProvider.body,
          permissions: ['services.create'],
        },
      };
    });
    await expect(page.locator('mat-sidenav [data-menu-item="service-publish"]')).toHaveCount(0);

    await page.goto('/profesional/servicios/publicacion');

    await expect(page).toHaveURL(/\/acceso-no-autorizado$/);
  });

  test('un organizador no entra a la publicación de servicios', async ({ page }) => {
    await loginAs(page, 'organizer');

    await page.goto('/profesional/servicios/publicacion');

    await expect(page).toHaveURL(/\/acceso-no-autorizado$/);
  });
});
