import { expect, test } from '@playwright/test';

import {
  CREATE_SESSION_RESPONSES,
  SIMULATED_ACCESS_TOKEN,
  SIMULATED_REFRESH_TOKEN,
  SIMULATED_RETRY_AFTER,
} from '../src/testing/bff-web/create-session.fixtures';
import { login, simulateSession } from './support/session-simulator';

/**
 * HU003 con el BFF reemplazado por el simulador derivado del contrato bff-web
 * 0.3.0. NO es E2E integrado: el recorrido real está en `login.integrated.spec.ts`.
 * Los inicios y menús por actor (CA7–CA10) están en `actor-navigation.spec.ts`.
 */

test.describe('HU003 Iniciar sesión (simulador del contrato) @simulado', () => {
  test('es la página inicial y desde ella se llega al registro', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveURL(/\/iniciar-sesion$/);
    await page.getByRole('link', { name: 'Crear cuenta' }).click();
    await expect(page).toHaveURL(/\/registro$/);
    await page.getByRole('link', { name: 'Inicia sesión' }).click();
    await expect(page).toHaveURL(/\/iniciar-sesion$/);
  });

  test('CA1: inicia sesión, redirige al inicio de su actor y no persiste tokens', async ({
    page,
  }) => {
    const requests = await simulateSession(page, CREATE_SESSION_RESPONSES.authenticated);

    await login(page);

    await expect(page).toHaveURL(/\/organizador\/inicio$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hola, Persona Sintética');
    await expect(page.getByTestId('session-user')).toHaveText('Persona Sintética');
    expect(requests[0].postDataJSON()).toEqual({
      email: 'persona@example.com',
      password: 'clave-sintetica-123',
    });

    const stored = await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage, cookies: document.cookie }),
    );
    expect(stored).not.toContain(SIMULATED_ACCESS_TOKEN);
    expect(stored).not.toContain(SIMULATED_REFRESH_TOKEN);

    // Con sesión vigente, el formulario de acceso lleva directo al inicio propio.
    await page
      .getByRole('navigation', { name: 'Navegación principal' })
      .getByRole('link', { name: 'Inicio' })
      .click();
    await page.evaluate(() => history.pushState({}, '', '/iniciar-sesion'));
    await page.goBack();
    await expect(page).toHaveURL(/\/organizador\/inicio$/);
  });

  test('con 0.3.0 el access token vive solo en memoria: al recargar hay que ingresar de nuevo', async ({
    page,
  }) => {
    await simulateSession(page, CREATE_SESSION_RESPONSES.authenticated);
    await login(page);
    await expect(page).toHaveURL(/\/organizador\/inicio$/);

    await page.reload();

    await expect(page).toHaveURL(/\/iniciar-sesion$/);
  });

  test('CA2/CA3: credenciales rechazadas → mensaje genérico, sin sesión', async ({ page }) => {
    await simulateSession(page, CREATE_SESSION_RESPONSES.invalidCredentials);

    await login(page);

    await expect(page.getByRole('alert')).toHaveText('Correo o contraseña incorrectos.');
    await expect(page.getByLabel('Contraseña', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('Contraseña', { exact: true })).toBeFocused();
    await expect(page).toHaveURL(/\/iniciar-sesion$/);
  });

  test('CA4: demasiados intentos → informa la espera indicada por el BFF', async ({ page }) => {
    await simulateSession(page, CREATE_SESSION_RESPONSES.tooManyAttempts, {
      'Retry-After': String(SIMULATED_RETRY_AFTER),
    });

    await login(page);

    await expect(page.getByRole('alert')).toHaveText(
      'Hiciste demasiados intentos. Intenta de nuevo en 10 min.',
    );
  });

  test('el inicio de un actor exige una sesión vigente', async ({ page }) => {
    await page.goto('/organizador/inicio');

    await expect(page).toHaveURL(/\/iniciar-sesion$/);
  });
});
