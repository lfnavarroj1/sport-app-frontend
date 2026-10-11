import { Page, expect, test } from '@playwright/test';

import { login, sessionFor, simulateSession } from './support/session-simulator';

/**
 * HU003 CA7–CA10 y ADR-025: inicio y menú lateral por tipo de actor, con el BFF
 * reemplazado por el simulador del contrato bff-web 0.3.0. NO es E2E integrado.
 */

async function loginAs(page: Page, actorType: string): Promise<void> {
  await simulateSession(page, sessionFor(actorType));
  await login(page);
}

const menu = (page: Page) => page.locator('mat-sidenav');
const menuItem = (page: Page, id: string) => page.locator(`[data-menu-item="${id}"]`);

test.describe('HU003 Inicio y navegación por actor (simulador del contrato) @simulado', () => {
  test('CA7: el deportista entra a su inicio con sus opciones base y el aviso del plan', async ({
    page,
  }) => {
    await loginAs(page, 'athlete');

    await expect(page).toHaveURL(/\/deportista\/inicio$/);
    await expect(page.getByTestId('shell-role')).toHaveText('Deportista');
    await expect(menuItem(page, 'plan')).toContainText('Mi plan');
    await expect(page.getByTestId('shell-plan-pending')).toBeVisible();
    await expect(menuItem(page, 'event-create')).toHaveCount(0);
    await expect(menuItem(page, 'service-create')).toHaveCount(0);
  });

  test('CA8: el organizador entra a su inicio y ve Crear evento, sin opciones de servicios ni plan', async ({
    page,
  }) => {
    await loginAs(page, 'organizer');

    await expect(page).toHaveURL(/\/organizador\/inicio$/);
    await expect(page.getByTestId('shell-role')).toHaveText('Organizador de eventos');
    await expect(menuItem(page, 'event-create')).toContainText('Crear evento');
    await expect(menuItem(page, 'event-create')).toContainText('Próximamente');
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
    await loginAs(page, 'organizer');

    const upcoming = menuItem(page, 'event-attendees');
    await expect(upcoming.locator('a, button')).toHaveCount(0);
    await upcoming.click();
    await expect(page).toHaveURL(/\/organizador\/inicio$/);

    const home = menu(page).getByRole('link', { name: 'Inicio' });
    await expect(home).toHaveAttribute('href', '/organizador/inicio');
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
