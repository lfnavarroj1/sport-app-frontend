import { Page, expect, test } from '@playwright/test';

import { REVOKE_SESSION_RESPONSES } from '../src/testing/bff-web/revoke-session.fixtures';
import {
  REFRESH_COOKIE,
  SessionSimulation,
  login,
  sessionFor,
  simulateSession,
} from './support/session-simulator';

/**
 * HU004 Cerrar sesión en la web, con el BFF reemplazado por el simulador del
 * contrato bff-web 0.13.0 (`POST /v1/sessions/revoke`, sin cambios desde 0.7.0).
 * NO es E2E integrado: el recorrido real está en `logout.integrated.spec.ts`.
 */

const HOMES = {
  athlete: /\/deportista\/inicio$/,
  organizer: /\/organizador\/inicio$/,
  service_provider: /\/profesional\/inicio$/,
} as const;

async function signIn(page: Page, actor: keyof typeof HOMES): Promise<SessionSimulation> {
  const simulation = await simulateSession(page, sessionFor(actor));
  await login(page);
  // El ingreso termina al llegar al inicio del actor: navegar antes perdería la sesión.
  await expect(page).toHaveURL(HOMES[actor]);
  return simulation;
}

const logoutButton = (page: Page) => page.locator('mat-sidenav [data-menu-item="logout"]');

async function refreshCookie(page: Page): Promise<string | undefined> {
  return (await page.context().cookies()).find((cookie) => cookie.name === REFRESH_COOKIE)?.value;
}

test.describe('HU004 Cerrar sesión (simulador del contrato) @simulado', () => {
  test('CA1 y CA3: el deportista cierra sesión, vuelve al acceso y no puede regresar ni renovar', async ({
    page,
  }) => {
    const simulation = await signIn(page, 'athlete');
    expect(await refreshCookie(page)).toBeDefined();

    await expect(logoutButton(page)).toHaveText(/Cerrar sesión/);
    await logoutButton(page).click();

    await expect(page).toHaveURL(/\/iniciar-sesion$/);
    await expect(page.getByTestId('login-logged-out')).toHaveText('Cerraste sesión.');
    expect(simulation.revokes).toHaveLength(1);
    const revoke = simulation.revokes[0];
    expect(revoke.postData()).toBeNull();
    expect(await revoke.headerValue('authorization')).toBeNull();
    expect(await revoke.headerValue('cookie')).toContain(`${REFRESH_COOKIE}=`);
    expect(await refreshCookie(page)).toBeUndefined();

    // «Atrás» no vuelve al área protegida: la entrada del historial se reemplazó.
    await page.goBack();
    await expect(page).not.toHaveURL(/\/deportista\//);

    // Una URL protegida intenta recuperar la sesión y la renovación se rechaza (CA3).
    const refreshes = simulation.refreshes.length;
    await page.goto('/deportista/inicio');
    await expect(page).toHaveURL(/\/iniciar-sesion$/);
    expect(simulation.refreshes.length).toBeGreaterThan(refreshes);
    await expect(page.getByTestId('login-logged-out')).toHaveCount(0);
  });

  for (const actor of ['organizer', 'service_provider'] as const) {
    test(`el actor ${actor} también cierra sesión desde su menú`, async ({ page }) => {
      const simulation = await signIn(page, actor);

      await logoutButton(page).click();

      await expect(page).toHaveURL(/\/iniciar-sesion$/);
      await expect(page.getByTestId('login-logged-out')).toHaveText('Cerraste sesión.');
      expect(simulation.revokes).toHaveLength(1);
    });
  }

  test('503: el BFF borra la cookie; se cierra en este navegador y se avisa que no se confirmó', async ({
    page,
  }) => {
    const simulation = await signIn(page, 'athlete');
    simulation.nextRevoke = REVOKE_SESSION_RESPONSES.upstreamUnavailable;

    await logoutButton(page).click();

    await expect(page).toHaveURL(/\/iniciar-sesion$/);
    await expect(page.getByTestId('login-logged-out')).toContainText(
      'el servidor no pudo confirmarlo',
    );
    expect(await refreshCookie(page)).toBeUndefined();
    await page.goto('/deportista/inicio');
    await expect(page).toHaveURL(/\/iniciar-sesion$/);
  });

  test('sin conexión la sesión sigue abierta, se explica y el reintento la cierra', async ({
    page,
  }) => {
    const simulation = await signIn(page, 'athlete');
    await page.route('**/v1/sessions/revoke', (route) => route.abort('internetdisconnected'), {
      times: 1,
    });

    await logoutButton(page).click();

    const alert = page.getByTestId('logout-error');
    await expect(alert).toContainText('no hay conexión');
    await expect(alert).toContainText('Tu sesión sigue abierta');
    await expect(page).toHaveURL(HOMES.athlete);
    expect(await refreshCookie(page)).toBeDefined();

    await logoutButton(page).click();

    await expect(page).toHaveURL(/\/iniciar-sesion$/);
    await expect(page.getByTestId('login-logged-out')).toHaveText('Cerraste sesión.');
    expect(simulation.revokes).toHaveLength(1);
  });

  test('403 origin_not_allowed: no se da por cerrada y muestra la referencia', async ({ page }) => {
    const simulation = await signIn(page, 'organizer');
    simulation.nextRevoke = REVOKE_SESSION_RESPONSES.originNotAllowed;

    await logoutButton(page).click();

    await expect(page.getByTestId('logout-error')).toContainText('No pudimos cerrar sesión');
    await expect(page.getByTestId('logout-error')).toContainText('Código de referencia');
    await expect(page).toHaveURL(HOMES.organizer);
  });

  test('un doble clic envía un solo cierre', async ({ page }) => {
    const simulation = await signIn(page, 'service_provider');

    await logoutButton(page).dblclick();

    await expect(page).toHaveURL(/\/iniciar-sesion$/);
    expect(simulation.revokes).toHaveLength(1);
  });
});
