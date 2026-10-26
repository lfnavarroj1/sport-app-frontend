import { Page, expect, test } from '@playwright/test';

import { GET_CAPABILITIES_RESPONSES } from '../src/testing/bff-web/capabilities.fixtures';
import { SimulatedResponse } from '../src/testing/bff-web/register-user.fixtures';
import { SessionSimulation, login, sessionFor, simulateSession } from './support/session-simulator';

/**
 * HU003 CA7–CA10 y ADR-025/ADR-024: inicio y menú lateral por tipo de actor, con
 * permisos y capacidades de `GET /v1/me/capabilities`. El BFF está reemplazado
 * por el simulador del contrato bff-web 0.13.0. NO es E2E integrado.
 */

async function loginAs(
  page: Page,
  actorType: string,
  capabilities: SimulatedResponse | null = null,
): Promise<SessionSimulation> {
  const simulation = await simulateSession(page, sessionFor(actorType));
  simulation.capabilities = capabilities;
  await login(page);
  return simulation;
}

const menu = (page: Page) => page.locator('mat-sidenav');
const menuItem = (page: Page, id: string) => page.locator(`[data-menu-item="${id}"]`);
const planStatus = (page: Page) => page.getByTestId('home-plan').getByRole('status');

test.describe('HU003 Inicio y navegación por actor (simulador del contrato) @simulado', () => {
  test('CA7: el deportista FREE ve sus opciones base y las de su plan aprobadas para la web', async ({
    page,
  }) => {
    const simulation = await loginAs(page, 'athlete');

    await expect(page).toHaveURL(/\/deportista\/inicio$/);
    await expect(page.getByTestId('shell-role')).toHaveText('Deportista');
    await expect(menuItem(page, 'plan')).toContainText('Mi plan');
    await expect(menu(page).locator('[data-menu-item="athlete-training-plans"]')).toContainText(
      'Planes de entrenamiento',
    );
    // HU018: «Calendario deportivo» ya navega al calendario integrado.
    await expect(menu(page).locator('[data-menu-item="sport-calendar"]')).toHaveAttribute(
      'href',
      '/deportista/calendario',
    );
    await expect(menuItem(page, 'sports-medicine')).toHaveCount(0);
    await expect(planStatus(page)).toHaveText(
      'Tu plan está activo. Sus opciones disponibles en la web aparecen en tu menú.',
    );
    await expect(menuItem(page, 'event-create')).toHaveCount(0);
    await expect(menuItem(page, 'service-create')).toHaveCount(0);
    expect(await simulation.capabilityRequests[0].headerValue('authorization')).toMatch(
      /^Bearer \S+$/,
    );
  });

  test('deportista PREMIUM: suma «Servicios médicos y deportivos»', async ({ page }) => {
    await loginAs(page, 'athlete', GET_CAPABILITIES_RESPONSES.athletePremium);

    await expect(menu(page).locator('[data-menu-item="sports-medicine"]')).toContainText(
      'Servicios médicos y deportivos',
    );
  });

  test('PROVISIONING: informa la activación sin opciones del plan y las muestra al activarse', async ({
    page,
  }) => {
    const simulation = await loginAs(
      page,
      'athlete',
      GET_CAPABILITIES_RESPONSES.athleteProvisioning,
    );

    await expect(page.getByTestId('shell-plan-provisioning')).toContainText(
      'Estamos activando tu plan',
    );
    await expect(menuItem(page, 'athlete-training-plans')).toHaveCount(0);

    simulation.capabilities = GET_CAPABILITIES_RESPONSES.athleteFree;

    await expect(menu(page).locator('[data-menu-item="athlete-training-plans"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId('shell-plan-provisioning')).toHaveCount(0);
  });

  test('si el BFF no puede evaluar el plan: error trazable, sin opciones asumidas, y reintento', async ({
    page,
  }) => {
    const simulation = await loginAs(
      page,
      'athlete',
      GET_CAPABILITIES_RESPONSES.upstreamUnavailable,
    );

    const error = page.getByTestId('shell-access').getByRole('alert');
    await expect(error).toContainText('El servicio no está disponible');
    await expect(error).toContainText('Código de referencia');
    await expect(menuItem(page, 'athlete-training-plans')).toHaveCount(0);

    simulation.capabilities = null;
    await error.getByRole('button', { name: 'Reintentar' }).click();

    await expect(menu(page).locator('[data-menu-item="athlete-training-plans"]')).toBeVisible();
  });

  test('CA10: si el BFF no admite el actor, la sesión termina en el acceso no autorizado', async ({
    page,
  }) => {
    await loginAs(page, 'athlete', GET_CAPABILITIES_RESPONSES.unsupportedActorType);

    await expect(page).toHaveURL(/\/acceso-no-autorizado$/);
    await expect(page.locator('mat-sidenav, [data-menu-item]')).toHaveCount(0);
  });

  test('CA8: el organizador entra a su inicio y ve Crear evento, sin opciones de servicios ni plan', async ({
    page,
  }) => {
    await loginAs(page, 'organizer');

    await expect(page).toHaveURL(/\/organizador\/inicio$/);
    await expect(page.getByTestId('shell-role')).toHaveText('Organizador de eventos');
    await expect(menuItem(page, 'event-create')).toContainText('Crear evento');
    // HU021 ya está implementada en la web: «Crear evento» es un enlace.
    await expect(menuItem(page, 'event-create')).toHaveAttribute(
      'href',
      '/organizador/eventos/nuevo',
    );
    await expect(menuItem(page, 'event-create')).not.toContainText('Próximamente');
    await expect(menuItem(page, 'service-create')).toHaveCount(0);
    await expect(menuItem(page, 'plan')).toHaveCount(0);
  });

  test('CA9: el profesional entra a su inicio y ve Crear y Publicar servicios, sin Crear evento', async ({
    page,
  }) => {
    await loginAs(page, 'service_provider');

    await expect(page).toHaveURL(/\/profesional\/inicio$/);
    await expect(page.getByTestId('shell-role')).toHaveText('Profesional de servicios');
    await expect(menuItem(page, 'service-create')).toContainText('Crear servicio');
    await expect(menuItem(page, 'service-publish')).toContainText('Publicar servicios');
    await expect(menuItem(page, 'event-create')).toHaveCount(0);
  });

  test('las opciones «Próximamente» no navegan; «Inicio» sí', async ({ page }) => {
    // Desde HU018 el organizador ya no tiene opciones «Próximamente»: se usa el
    // historial de molestias o lesiones del profesional (HU012).
    await loginAs(page, 'service_provider');

    const upcoming = menuItem(page, 'health-history');
    await expect(upcoming).toContainText('Próximamente');
    await expect(upcoming.locator('a, button')).toHaveCount(0);
    await upcoming.click();
    await expect(page).toHaveURL(/\/profesional\/inicio$/);

    const home = menu(page).getByRole('link', { name: 'Inicio' });
    await expect(home).toHaveAttribute('href', '/profesional/inicio');
    await expect(home).toHaveAttribute('aria-current', 'page');
  });

  test('CA10: un actor desconocido no inicia sesión ni recibe menú de negocio', async ({
    page,
  }) => {
    await loginAs(page, 'admin');

    await expect(page).toHaveURL(/\/acceso-no-autorizado$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Acceso no autorizado');
    await expect(page.locator('mat-sidenav, [data-menu-item]')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Ir a iniciar sesión' })).toBeVisible();

    await page.goto('/deportista/inicio');
    await expect(page).toHaveURL(/\/iniciar-sesion$/);
  });

  test('CA10: la URL de otro actor queda bloqueada por la guarda', async ({ page }) => {
    await loginAs(page, 'athlete');
    await expect(page).toHaveURL(/\/deportista\/inicio$/);

    // Navegación interna (la sesión vive en memoria y se perdería al recargar).
    await page.evaluate(() => {
      history.pushState({}, '', '/organizador/inicio');
      dispatchEvent(new PopStateEvent('popstate'));
    });

    await expect(page).toHaveURL(/\/acceso-no-autorizado$/);
    await page.getByRole('link', { name: 'Ir a mi inicio' }).click();
    await expect(page).toHaveURL(/\/deportista\/inicio$/);
  });

  test('en pantallas pequeñas el menú se abre con un botón accesible', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAs(page, 'organizer');

    const toggle = page.getByRole('button', { name: 'Menú' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(menuItem(page, 'event-create')).toBeVisible();
  });
});
