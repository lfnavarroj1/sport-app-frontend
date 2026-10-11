import { expect, test } from '@playwright/test';

/** Esqueleto de HU003: punto de entrada de la aplicación; no autentica todavía. */
test.describe('Inicio de sesión (esqueleto HU003)', () => {
  test('es la página inicial y desde ella se llega al registro', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveURL(/\/iniciar-sesion$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Iniciar sesión' })).toBeVisible();
    await expect(
      page.getByRole('navigation').getByRole('link', { name: 'Iniciar sesión' }),
    ).toHaveAttribute('aria-current', 'page');

    await page.getByRole('link', { name: 'Crear cuenta' }).click();
    await expect(page).toHaveURL(/\/registro$/);

    await page.getByRole('link', { name: 'Inicia sesión' }).click();
    await expect(page).toHaveURL(/\/iniciar-sesion$/);
  });

  test('no simula un ingreso ni envía la contraseña a ningún servicio', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (request) => {
      if (request.method() !== 'GET') requests.push(request.url());
    });
    await page.goto('/iniciar-sesion');

    await page.getByLabel('Correo electrónico').fill('persona@example.com');
    await page.getByLabel('Contraseña', { exact: true }).fill('clave-sintetica-123');
    await page.getByRole('button', { name: 'Ingresar' }).click();

    await expect(page.getByRole('status')).toContainText(
      'El inicio de sesión todavía no está disponible.',
    );
    await expect(page.getByLabel('Contraseña', { exact: true })).toHaveValue('');
    expect(requests).toEqual([]);
  });
});
