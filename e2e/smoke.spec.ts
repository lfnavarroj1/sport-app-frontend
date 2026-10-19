import { expect, test } from '@playwright/test';

test.describe('Arranque de la aplicación @smoke', () => {
  test('carga la ruta técnica con configuración e i18n', async ({ page }) => {
    await page.goto('/status');

    await expect(page.getByRole('heading', { level: 1, name: 'Estado técnico' })).toBeVisible();
    await expect(page.getByTestId('environment')).not.toBeEmpty();
    await expect(page.getByTestId('diagnostic-id')).toHaveText(/^[0-9a-f-]{36}$/);
    await expect(page.getByTestId('startup-failure')).toHaveCount(0);
  });

  test('permite saltar al contenido principal con el teclado', async ({ page }) => {
    await page.goto('/status');
    // La aplicación arranca después de leer app-config.json; sin esperar, Tab puede
    // llegar antes de que exista el enlace.
    await expect(page.getByRole('heading', { level: 1, name: 'Estado técnico' })).toBeVisible();

    await page.keyboard.press('Tab');
    const skipLink = page.getByRole('link', { name: 'Saltar al contenido principal' });
    await expect(skipLink).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(page.locator('main#main-content')).toBeFocused();
  });
});
