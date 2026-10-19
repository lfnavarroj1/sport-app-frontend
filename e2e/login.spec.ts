import { expect, test } from '@playwright/test';

import {
  CREATE_SESSION_RESPONSES,
  SIMULATED_ACCESS_TOKEN,
  SIMULATED_RETRY_AFTER,
} from '../src/testing/bff-web/create-session.fixtures';
import {
  REFRESH_SESSION_RESPONSES,
  SIMULATED_RENEWED_ACCESS_TOKEN,
} from '../src/testing/bff-web/refresh-session.fixtures';
import {
  REFRESH_COOKIE,
  login,
  simulateNoSession,
  simulateSession,
} from './support/session-simulator';

/**
 * HU003 con el BFF reemplazado por el simulador derivado del contrato bff-web
 * 0.13.0. NO es E2E integrado: el recorrido real está en `login.integrated.spec.ts`.
 * Los inicios y menús por actor (CA7–CA10) están en `actor-navigation.spec.ts`.
 */

test.describe('HU003 Iniciar sesión (simulador del contrato) @simulado', () => {
  test('es la página inicial y desde ella se llega al registro', async ({ page }) => {
    await simulateNoSession(page);
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
    const simulation = await simulateSession(page, CREATE_SESSION_RESPONSES.authenticated);

    await login(page);

    await expect(page).toHaveURL(/\/organizador\/inicio$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hola, Persona Sintética');
    await expect(page.getByTestId('session-user')).toHaveText('Persona Sintética');
    expect(simulation.logins[0].postDataJSON()).toEqual({
      email: 'persona@example.com',
      password: 'clave-sintetica-123',
    });

    const stored = await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage, cookies: document.cookie }),
    );
    expect(stored).not.toContain(SIMULATED_ACCESS_TOKEN);
    expect(stored).not.toContain(simulation.refreshTokens[0]);

    // El refresh token solo existe en la cookie HttpOnly que fijó el BFF.
    const cookies = await page.context().cookies();
    expect(cookies.find((cookie) => cookie.name === REFRESH_COOKIE)).toEqual(
      expect.objectContaining({
        value: simulation.refreshTokens[0],
        httpOnly: true,
        secure: true,
        path: '/v1/sessions',
      }),
    );

    // Con sesión vigente, el formulario de acceso lleva directo al inicio propio.
    await page
      .getByRole('navigation', { name: 'Navegación principal' })
      .getByRole('link', { name: 'Inicio' })
      .click();
    await page.evaluate(() => history.pushState({}, '', '/iniciar-sesion'));
    await page.goBack();
    await expect(page).toHaveURL(/\/organizador\/inicio$/);
  });

  test('mantiene la sesión al recargar: la recupera con la cookie HttpOnly', async ({ page }) => {
    const simulation = await simulateSession(page, CREATE_SESSION_RESPONSES.authenticated);
    await login(page);
    await expect(page).toHaveURL(/\/organizador\/inicio$/);

    await page.reload();

    await expect(page).toHaveURL(/\/organizador\/inicio$/);
    await expect(page.getByTestId('session-user')).toHaveText('Persona Sintética');
    expect(simulation.refreshes.at(-1)?.postData()).toBeNull();

    // La renovación rotó la cookie; abrir el acceso también lleva al inicio propio.
    await page.goto('/iniciar-sesion');
    await expect(page).toHaveURL(/\/organizador\/inicio$/);
  });

  test('si la cookie ya no es válida, al recargar pide ingresar de nuevo', async ({ page }) => {
    const simulation = await simulateSession(page, CREATE_SESSION_RESPONSES.authenticated);
    await login(page);
    await expect(page).toHaveURL(/\/organizador\/inicio$/);

    simulation.nextRefresh = REFRESH_SESSION_RESPONSES.invalidRefreshToken;
    await page.reload();

    await expect(page).toHaveURL(/\/iniciar-sesion$/);
    expect((await page.context().cookies()).some((cookie) => cookie.name === REFRESH_COOKIE)).toBe(
      false,
    );
  });

  test('renueva el access token antes de que venza y la sesión continúa', async ({ page }) => {
    await page.clock.install();
    const simulation = await simulateSession(page, CREATE_SESSION_RESPONSES.authenticated);
    await login(page);
    await expect(page).toHaveURL(/\/organizador\/inicio$/);
    const refreshesAtLogin = simulation.refreshes.length;

    // El access token simulado dura 15 min; se renueva 1 min antes.
    await page.clock.runFor('14:01');
    await expect.poll(() => simulation.refreshes.length).toBe(refreshesAtLogin + 1);
    await page.clock.runFor('02:00');

    await expect(page).toHaveURL(/\/organizador\/inicio$/);
    const stored = await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage, cookies: document.cookie }),
    );
    expect(stored).not.toContain(SIMULATED_RENEWED_ACCESS_TOKEN);
  });

  test('si la renovación es rechazada, la sesión termina e informa que expiró', async ({
    page,
  }) => {
    await page.clock.install();
    const simulation = await simulateSession(page, CREATE_SESSION_RESPONSES.authenticated);
    await login(page);
    await expect(page).toHaveURL(/\/organizador\/inicio$/);

    simulation.nextRefresh = REFRESH_SESSION_RESPONSES.invalidRefreshToken;
    await page.clock.runFor('14:01');

    await expect(page).toHaveURL(/\/iniciar-sesion$/);
    await expect(page.getByTestId('login-session-expired')).toHaveText(
      'Tu sesión expiró. Ingresa de nuevo para continuar.',
    );
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
    const simulation = await simulateNoSession(page);
    await page.goto('/organizador/inicio');

    await expect(page).toHaveURL(/\/iniciar-sesion$/);
    // Antes de pedir el acceso intentó recuperar la sesión con la cookie.
    expect(simulation.refreshes.length).toBeGreaterThan(0);
  });
});
