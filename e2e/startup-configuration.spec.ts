import { expect, test } from '@playwright/test';

test.describe('Configuración de arranque', () => {
  test('no arranca a medias si app-config.json es inválido', async ({ page }) => {
    await page.route('**/app-config.json', (route) =>
      route.fulfill({ json: { environment: 'desconocido' } }),
    );

    await page.goto('/');

    await expect(page.getByTestId('startup-failure')).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('problema de configuración');
    await expect(page.locator('app-root')).toHaveCount(0);
  });

  test('no arranca si app-config.json no existe', async ({ page }) => {
    await page.route('**/app-config.json', (route) => route.fulfill({ status: 404 }));

    await page.goto('/');

    await expect(page.getByTestId('startup-failure')).toBeVisible();
  });
});
