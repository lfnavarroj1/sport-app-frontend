import { Page, Request, expect, test } from '@playwright/test';

import {
  REGISTER_USER_PATH,
  REGISTER_USER_RESPONSES,
  SimulatedResponse,
} from '../src/testing/bff-web/register-user.fixtures';
import { simulateNoSession } from './support/session-simulator';

/**
 * HU001: aviso de tratamiento de datos (`sportapp-c108-c108plus.v1`) y
 * consentimiento explícito del registro, con el BFF reemplazado por el simulador
 * del contrato. NO es E2E integrado.
 */

const VERSION = 'sportapp-c108-c108plus.v1';
const PASSWORD = 'clave-sintetica-123';
const CONVENTION_108 = 'https://www.coe.int/en/web/data-protection/convention108-and-protocol';
const CONVENTION_108_PLUS = 'https://www.coe.int/en/web/data-protection/convention108/modernised';

async function simulateRegistration(
  page: Page,
  ...responses: SimulatedResponse[]
): Promise<Request[]> {
  const requests: Request[] = [];
  await page.route(`**${REGISTER_USER_PATH}`, async (route) => {
    if (route.request().method() !== 'POST') {
      return route.fallback();
    }
    requests.push(route.request());
    const response = responses[Math.min(requests.length, responses.length) - 1];
    await route.fulfill({
      status: response.status,
      json: response.body,
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  });
  return requests;
}

async function fillAccount(page: Page): Promise<void> {
  await page.getByLabel('Nombre completo').fill('Persona Sintética');
  await page.getByLabel('Correo electrónico').fill('persona@example.com');
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Tipo de usuario').click();
  await page.getByRole('option', { name: 'Deportista' }).click();
}

const consent = (page: Page) => page.getByLabel(/Acepto las políticas/);

async function openRegistration(page: Page): Promise<void> {
  await simulateNoSession(page);
  await page.goto('/registro');
  await expect(page.getByRole('heading', { level: 1, name: 'Crear cuenta' })).toBeVisible();
}

/** La página no se desplaza en horizontal (diseño adaptable). */
async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('HU001 Aviso de tratamiento de datos (simulador del contrato) @simulado', () => {
  test('el aviso puede leerse en el formulario antes de aceptar, con el teclado', async ({
    page,
  }) => {
    await openRegistration(page);
    const toggle = page.getByTestId('registration-notice-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(consent(page)).not.toBeChecked();

    await toggle.focus();
    await page.keyboard.press('Enter');

    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const region = page.getByRole('region', { name: 'Aviso de tratamiento de datos' });
    await expect(region).toBeVisible();
    await expect(region.getByTestId('privacy-notice-version')).toHaveText(VERSION);
    for (const title of [
      'Qué datos recopilamos',
      'Para qué usamos tus datos',
      'Minimización y calidad de los datos',
      'Cuánto tiempo conservamos tus datos',
      'Cómo protegemos tus datos',
      'Quién puede ver tus datos',
      'Datos sensibles y de salud',
      'Tus derechos',
      'Cómo ejercer tus derechos',
    ]) {
      await expect(
        region.getByRole('heading', { level: 3, name: title, exact: true }),
      ).toBeVisible();
    }
    // Leer el aviso no acepta nada.
    await expect(consent(page)).not.toBeChecked();
  });

  test('sin aceptar no se registra; aceptar envía exactamente la versión aprobada', async ({
    page,
  }) => {
    await openRegistration(page);
    const requests = await simulateRegistration(page, REGISTER_USER_RESPONSES.registered);
    await fillAccount(page);

    await page.getByRole('button', { name: 'Registrarme' }).click();

    await expect(page.getByTestId('registration-policies-error')).toContainText(
      'Debes aceptar las políticas para registrarte.',
    );
    expect(requests).toHaveLength(0);
    await expect(consent(page)).toBeFocused();

    await page.keyboard.press('Space');
    await expect(consent(page)).toBeChecked();
    await page.getByRole('button', { name: 'Registrarme' }).click();

    await expect(page.getByTestId('registration-success')).toBeVisible();
    expect(requests).toHaveLength(1);
    expect(requests[0].postDataJSON().accepted_policies_version).toBe(VERSION);
  });

  test('la etiqueta abre el aviso completo en una pestaña nueva sin perder el formulario', async ({
    page,
  }) => {
    await openRegistration(page);
    await fillAccount(page);
    const link = page.getByTestId('registration-notice-link');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');

    const [notice] = await Promise.all([page.context().waitForEvent('page'), link.click()]);

    await notice.waitForLoadState();
    await expect(notice).toHaveURL(/\/aviso-de-privacidad$/);
    await expect(
      notice.getByRole('heading', {
        level: 1,
        name: 'Aviso de tratamiento de datos personales de SportApp',
      }),
    ).toBeVisible();
    await expect(notice.getByTestId('privacy-notice-version')).toHaveText(VERSION);
    // Abrir el enlace no marca la casilla ni borra lo capturado.
    await expect(consent(page)).not.toBeChecked();
    await expect(page.getByLabel('Correo electrónico')).toHaveValue('persona@example.com');
    // La pestaña abierta no puede manipular la del registro.
    expect(await notice.evaluate(() => window.opener)).toBeNull();
  });

  test('los enlaces a los Convenios 108 y 108+ son los oficiales y se abren de forma segura', async ({
    page,
    context,
  }) => {
    // Las páginas del Consejo de Europa se sustituyen: la prueba no depende de la red.
    await context.route('https://www.coe.int/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<title>CoE</title>' }),
    );
    await simulateNoSession(page);
    await page.goto('/aviso-de-privacidad');

    for (const [id, url] of [
      ['convention108', CONVENTION_108],
      ['convention108plus', CONVENTION_108_PLUS],
    ] as const) {
      const link = page.getByTestId(`privacy-notice-link-${id}`);
      await expect(link).toHaveAttribute('href', url);
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      await expect(link).toContainText('(se abre en una pestaña nueva)');

      const [external] = await Promise.all([context.waitForEvent('page'), link.click()]);
      await expect(external).toHaveURL(url);
      expect(await external.evaluate(() => window.opener)).toBeNull();
      await external.close();
    }
  });

  test('una versión obsoleta pide aceptar de nuevo y permite recargar la vigente', async ({
    page,
  }) => {
    await openRegistration(page);
    const requests = await simulateRegistration(
      page,
      REGISTER_USER_RESPONSES.policiesVersionMismatch,
    );
    await fillAccount(page);
    await consent(page).check();

    await page.getByRole('button', { name: 'Registrarme' }).click();

    const error = page.getByTestId('registration-policies-error');
    await expect(error).toContainText('La versión del aviso que aceptaste ya no está vigente.');
    await expect(consent(page)).not.toBeChecked();
    expect(requests).toHaveLength(1);

    await error.getByRole('button', { name: 'Recargar y leer la versión vigente' }).click();

    await expect(page).toHaveURL(/\/registro$/);
    await expect(page.getByLabel('Contraseña', { exact: true })).toHaveValue('');
    await expect(consent(page)).not.toBeChecked();
    await expect(page.getByTestId('registration-notice-link')).toBeVisible();
  });

  test('la contraseña no queda en el navegador ni en la pantalla tras registrarse', async ({
    page,
  }) => {
    await openRegistration(page);
    await simulateRegistration(page, REGISTER_USER_RESPONSES.registered);
    await fillAccount(page);
    await consent(page).check();

    await page.getByRole('button', { name: 'Registrarme' }).click();

    await expect(page.getByTestId('registration-success')).toBeVisible();
    await expect(page.getByLabel('Contraseña', { exact: true })).toHaveCount(0);
    const stored = await page.evaluate(() =>
      JSON.stringify([
        Object.entries(localStorage),
        Object.entries(sessionStorage),
        document.cookie,
      ]),
    );
    expect(stored).not.toContain(PASSWORD);
    expect(await page.content()).not.toContain(PASSWORD);
  });

  test('el aviso y el registro se adaptan a una pantalla estrecha', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openRegistration(page);
    await page.getByTestId('registration-notice-toggle').click();
    await expectNoHorizontalScroll(page);

    await page.goto('/aviso-de-privacidad');
    await expect(page.getByTestId('privacy-notice')).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});
