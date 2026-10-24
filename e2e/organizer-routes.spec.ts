import { Page, expect, test } from '@playwright/test';

import { GET_CAPABILITIES_RESPONSES } from '../src/testing/bff-web/capabilities.fixtures';
import { PUBLISH_ROUTE_RESPONSES, organizerRoute } from '../src/testing/bff-web/routes.fixtures';
import { RoutesSimulation, simulateRoutes } from './support/routes-simulator';
import { SessionSimulation, login, sessionFor, simulateSession } from './support/session-simulator';

/**
 * HU026 Sugerir rutas (web del organizador): publica rutas y retira las propias
 * en `/organizador/rutas` (ADR-041). El BFF está reemplazado por el simulador del
 * contrato bff-web 0.23.0. NO es E2E integrado.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function loginAs(
  page: Page,
  actorType = 'organizer',
  routes = [organizerRoute(1), organizerRoute(2)],
  configure: (session: SessionSimulation) => void = () => undefined,
): Promise<RoutesSimulation> {
  const session = await simulateSession(page, sessionFor(actorType));
  configure(session);
  const simulation = await simulateRoutes(page, routes);
  await login(page);
  // El ingreso termina al llegar al inicio del actor: navegar antes perdería la sesión.
  await expect(page).toHaveURL(/\/(deportista|profesional|organizador)\/inicio$/);
  return simulation;
}

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const form = (page: Page) => page.getByTestId('route-form');
const items = (page: Page) => page.getByTestId('routes-list').locator('li[data-route]');

async function openRoutes(page: Page): Promise<void> {
  await page.locator('mat-sidenav [data-menu-item="organizer-routes"]').click();
  await expect(page).toHaveURL(/\/organizador\/rutas$/);
}

async function choose(page: Page, label: string, option: string): Promise<void> {
  await form(page)
    .locator('mat-form-field', { has: page.getByLabel(label, { exact: true }) })
    .click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

async function fillRoute(page: Page): Promise<void> {
  await form(page).getByLabel('Nombre', { exact: true }).fill('Vuelta al Parque Simón Bolívar');
  await choose(page, 'Deporte', 'Carrera');
  await form(page).getByLabel('Distancia (km)').fill('12,5');
  await choose(page, 'Dificultad', 'Moderada');
  await form(page).getByLabel('Ciudad').fill('Bogotá');
  await form(page).getByLabel('País (código ISO de 2 letras)').fill('co');
  await form(page).getByLabel('Latitud de inicio').fill('4.6584');
  await form(page).getByLabel('Longitud de inicio').fill('-74.0937');
}

test.describe('HU026 Rutas del organizador (simulador del contrato) @simulado', () => {
  test('CA1: publica una ruta con puntos intermedios y la ve primera en su lista', async ({
    page,
  }) => {
    const simulation = await loginAs(page);
    await openRoutes(page);
    await expect(items(page)).toHaveCount(2);

    await button(page, 'Publicar una ruta').click();
    await fillRoute(page);
    await button(page, 'Agregar punto intermedio').click();
    await form(page).getByLabel('Latitud del punto 1').fill('4.6601');
    await form(page).getByLabel('Longitud del punto 1').fill('-74.0902');
    await button(page, 'Publicar ruta').click();

    await expect(page.getByTestId('route-published')).toHaveText(
      /Publicamos la ruta «Vuelta al Parque Simón Bolívar»/,
    );
    await expect(items(page)).toHaveCount(3);
    const first = items(page).first();
    await expect(first).toContainText('Vuelta al Parque Simón Bolívar');
    await expect(first).toContainText('Publicada');
    await expect(first.getByTestId('route-distance')).toHaveText('12,5 km');
    await expect(first.getByTestId('route-start')).toHaveText('4,6584, -74,0937');
    await expect(first.getByTestId('route-waypoints')).toContainText('4,6601, -74,0902');

    expect(simulation.publishRequests).toHaveLength(1);
    const request = simulation.publishRequests[0];
    expect(await request.headerValue('idempotency-key')).toMatch(UUID);
    // Sin `organizer_id`; distancia con punto y país en mayúsculas.
    expect(request.postDataJSON()).toEqual({
      name: 'Vuelta al Parque Simón Bolívar',
      description: null,
      sport: 'running',
      distance_km: '12.5',
      difficulty: 'MODERATE',
      city: 'Bogotá',
      country_code: 'CO',
      start_point: { lat: 4.6584, lng: -74.0937 },
      waypoints: [{ lat: 4.6601, lng: -74.0902 }],
    });

    // Al recargar, la ruta llega de la consulta.
    await page.reload();
    await expect(items(page).first()).toContainText('Vuelta al Parque Simón Bolívar');
  });

  test('CA2: las reglas del backend se marcan en su campo y nada se publica', async ({ page }) => {
    const simulation = await loginAs(page);
    await openRoutes(page);
    simulation.nextPublish.push(PUBLISH_ROUTE_RESPONSES.validationError);
    await button(page, 'Publicar una ruta').click();
    await fillRoute(page);
    await button(page, 'Agregar punto intermedio').click();
    await button(page, 'Agregar punto intermedio').click();
    for (const n of [1, 2]) {
      await form(page).getByLabel(`Latitud del punto ${n}`).fill('4.66');
      await form(page).getByLabel(`Longitud del punto ${n}`).fill('-74.09');
    }
    await button(page, 'Publicar ruta').click();

    const errors = page.getByTestId('route-errors');
    await expect(errors).toBeFocused();
    await expect(errors.getByRole('listitem')).toHaveText([
      'Distancia (km): El valor está fuera del rango permitido.',
      'Latitud de inicio: El valor está fuera del rango permitido.',
      'País (código ISO de 2 letras): El valor no es válido.',
      'Punto intermedio 2 (longitud): El valor está fuera del rango permitido.',
    ]);
    await expect(page.getByTestId('route-published')).toHaveCount(0);
    await expect(items(page)).toHaveCount(2);
  });

  test('CA2: el formulario no envía coordenadas ni distancias fuera de rango', async ({ page }) => {
    const simulation = await loginAs(page);
    await openRoutes(page);
    await button(page, 'Publicar una ruta').click();
    await fillRoute(page);
    await form(page).getByLabel('Distancia (km)').fill('600');
    await form(page).getByLabel('Latitud de inicio').fill('95');
    await button(page, 'Publicar ruta').click();

    await expect(form(page)).toContainText('Debe estar entre 0,1 y 500,0 km');
    expect(simulation.publishRequests).toHaveLength(0);
  });

  test('CA1: ante 503 reintenta con la misma clave y publica una sola ruta', async ({ page }) => {
    const simulation = await loginAs(page);
    await openRoutes(page);
    simulation.nextPublish.push(PUBLISH_ROUTE_RESPONSES.upstreamUnavailable);
    await button(page, 'Publicar una ruta').click();
    await fillRoute(page);
    await button(page, 'Publicar ruta').click();

    await expect(page.getByTestId('route-published')).toBeVisible();
    expect(simulation.publishRequests).toHaveLength(2);
    const [first, second] = await Promise.all(
      simulation.publishRequests.map((request) => request.headerValue('idempotency-key')),
    );
    expect(second).toBe(first);
    expect(simulation.routes.filter((route) => route.name.startsWith('Vuelta'))).toHaveLength(1);
  });

  test('CA4: retira una ruta tras confirmar; se conserva como retirada', async ({ page }) => {
    const simulation = await loginAs(page);
    await openRoutes(page);
    const target = items(page).first();
    await target.getByRole('button', { name: /^Retirar la ruta/ }).click();
    await expect(target).toContainText('Dejará de sugerirse');
    await target.getByRole('button', { name: 'Sí, retirar' }).click();

    await expect(target).toContainText('Retirada');
    await expect(target).toContainText('Retiramos la ruta');
    await expect(target.getByRole('button', { name: /Retirar/ })).toHaveCount(0);
    await expect(items(page)).toHaveCount(2);
    expect(simulation.retireRequests[0].postDataJSON()).toEqual({ expected_version: 1 });
  });

  test('CA4: una versión vencida no retira y ofrece actualizar la lista', async ({ page }) => {
    const simulation = await loginAs(page);
    await openRoutes(page);
    // Otra sesión cambió la ruta: la vigente es la versión 2.
    simulation.routes = simulation.routes.map((route, index) =>
      index === 0 ? { ...route, version: 2 } : route,
    );
    const target = items(page).first();
    await target.getByRole('button', { name: /^Retirar la ruta/ }).click();
    await target.getByRole('button', { name: 'Sí, retirar' }).click();

    await expect(target).toContainText('no se retiró');
    await expect(target).toContainText('Publicada');
    await target.getByRole('button', { name: 'Actualizar lista' }).click();
    await expect(items(page).first()).not.toContainText('no se retiró');
  });

  test('sin training.routes.author la opción no aparece y la ruta directa se rechaza', async ({
    page,
  }) => {
    await loginAs(page, 'organizer', [], (session) => {
      session.capabilities = {
        status: 200,
        body: {
          ...GET_CAPABILITIES_RESPONSES.organizer.body,
          permissions: GET_CAPABILITIES_RESPONSES.organizer.body.permissions.filter(
            (permission) => permission !== 'training.routes.author',
          ),
        },
      };
    });

    await expect(page.locator('mat-sidenav [data-menu-item="organizer-routes"]')).toHaveCount(0);
    await page.goto('/organizador/rutas');
    await expect(page).toHaveURL(/\/acceso-no-autorizado$/);
  });

  test('un profesional no entra a las rutas del organizador', async ({ page }) => {
    await loginAs(page, 'service_provider');
    await page.goto('/organizador/rutas');

    await expect(page).toHaveURL(/\/acceso-no-autorizado$/);
  });
});
