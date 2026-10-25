import { Page, expect, test } from '@playwright/test';

import { REFRESH_SESSION_RESPONSES } from '../src/testing/bff-web/refresh-session.fixtures';
import { PUT_ACCOUNT_RESPONSES } from '../src/testing/bff-web/account.fixtures';
import { AccountSimulation, simulateAccount } from './support/account-simulator';
import { simulateProfile } from './support/profile-simulator';
import { SessionSimulation, login, sessionFor, simulateSession } from './support/session-simulator';

/**
 * HU002 Editar información del usuario: en «Mi perfil» de cada actor, la
 * sección «Datos personales» edita el nombre y el correo con control de versión
 * (ADR-035). El BFF está reemplazado por el simulador del contrato bff-web
 * 0.28.0. NO es E2E integrado.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const ACTORS = [
  { actorType: 'athlete', area: 'deportista' },
  { actorType: 'organizer', area: 'organizador' },
  { actorType: 'service_provider', area: 'profesional' },
] as const;

interface Simulations {
  readonly session: SessionSimulation;
  readonly account: AccountSimulation;
}

/** Inicia sesión como `actorType`; la cuenta simulada se comparte entre las pestañas del contexto. */
async function loginAs(page: Page, actorType = 'athlete'): Promise<Simulations> {
  const session = await simulateSession(page, sessionFor(actorType));
  // El perfil deportivo del deportista; la cuenta propia se registra después y tiene prioridad.
  await simulateProfile(page.context());
  const account = await simulateAccount(page.context(), actorType);
  await login(page);
  // El ingreso termina al llegar al inicio del actor: navegar antes perdería la sesión.
  await expect(page).toHaveURL(/\/(deportista|profesional|organizador)\/inicio$/);
  return { session, account };
}

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

async function openProfile(page: Page, area: string): Promise<void> {
  await page.locator('mat-sidenav [data-menu-item="profile"]').click();
  await expect(page).toHaveURL(new RegExp(`/${area}/perfil$`));
  await expect(page.getByTestId('account-summary')).toBeVisible();
}

async function editAccount(page: Page, fullName: string, email: string): Promise<void> {
  await button(page, 'Editar datos personales').click();
  await page.getByLabel('Nombre completo').fill(fullName);
  await page.getByLabel('Correo electrónico').fill(email);
  await button(page, 'Guardar datos personales').click();
}

test.describe('HU002 Datos personales (simulador del contrato) @simulado', () => {
  for (const { actorType, area } of ACTORS) {
    test(`CA1 y CA6 (${actorType}): edita nombre y correo, ve lo confirmado y la sesión sigue`, async ({
      page,
    }) => {
      const { session, account } = await loginAs(page, actorType);
      await openProfile(page, area);

      await expect(page.getByRole('heading', { level: 2, name: 'Datos personales' })).toBeVisible();
      await expect(page.getByTestId('account-full-name')).toHaveText('Persona Sintética');
      await expect(page.getByTestId('account-email')).toHaveText('persona@example.com');
      if (actorType !== 'athlete') {
        // El organizador y el profesional solo tienen datos personales.
        await expect(page.getByTestId('profile-hu005')).toHaveCount(0);
        await expect(
          page.getByTestId('profile-page').getByRole('heading', { level: 2 }),
        ).toHaveCount(1);
      }

      await editAccount(page, '  Persona   Renombrada ', 'Persona.Nueva@Example.com');

      await expect(page.getByTestId('account-saved')).toHaveText('Guardamos tus datos personales.');
      // Se muestra lo que confirmó el backend (normalizado), no lo escrito.
      await expect(page.getByTestId('account-full-name')).toHaveText('Persona Renombrada');
      await expect(page.getByTestId('account-email')).toHaveText('persona.nueva@example.com');
      // CA6: la cabecera muestra el nombre nuevo sin cerrar la sesión.
      await expect(page.getByTestId('session-user')).toHaveText('Persona Renombrada');
      await expect(page).toHaveURL(new RegExp(`/${area}/perfil$`));

      expect(account.requests).toHaveLength(1);
      const [request] = account.requests;
      expect(await request.headerValue('authorization')).toMatch(/^Bearer \S+$/);
      expect(await request.headerValue('idempotency-key')).toMatch(UUID);
      // CA2: solo nombre, correo y versión; nunca user_id, actor_type, status ni contraseña.
      expect(request.postDataJSON()).toEqual({
        expected_version: 1,
        full_name: 'Persona   Renombrada',
        email: 'Persona.Nueva@Example.com',
      });

      // Al recargar, la sesión se renueva (el BFF ya entrega el nombre nuevo) y la
      // cuenta llega de la consulta.
      const renewed = REFRESH_SESSION_RESPONSES.renewed.body;
      session.nextRefresh = {
        status: 200,
        body: {
          ...renewed,
          user: {
            ...renewed.user,
            actor_type: actorType,
            full_name: 'Persona Renombrada',
            email: 'persona.nueva@example.com',
          },
        },
      };
      await page.reload();
      await expect(page.getByTestId('account-full-name')).toHaveText('Persona Renombrada');
      await expect(page.getByTestId('account-email')).toHaveText('persona.nueva@example.com');
      await expect(page.getByTestId('session-user')).toHaveText('Persona Renombrada');
    });
  }

  test('CA6: tras cerrar sesión, el siguiente inicio usa el correo nuevo', async ({ page }) => {
    const { session } = await loginAs(page, 'organizer');
    await openProfile(page, 'organizador');
    await editAccount(page, 'Persona Sintética', 'persona.nueva@example.com');
    await expect(page.getByTestId('account-email')).toHaveText('persona.nueva@example.com');

    await page.locator('mat-sidenav [data-menu-item="logout"]').click();
    await expect(page).toHaveURL(/\/iniciar-sesion/);
    await page.getByLabel('Correo electrónico').fill('persona.nueva@example.com');
    await page.getByLabel('Contraseña', { exact: true }).fill('clave-sintetica-123');
    await page.getByRole('button', { name: 'Ingresar' }).click();

    await expect(page).toHaveURL(/\/organizador\/inicio$/);
    expect(session.logins.at(-1)?.postDataJSON()).toEqual(
      expect.objectContaining({ email: 'persona.nueva@example.com' }),
    );
  });

  test('CA3: un correo de otra cuenta se marca en el campo y se conserva el anterior', async ({
    page,
  }) => {
    const { account } = await loginAs(page, 'service_provider');
    account.takenEmails.add('ocupado@example.com');
    await openProfile(page, 'profesional');

    await editAccount(page, 'Persona Sintética', 'ocupado@example.com');

    const email = page.getByLabel('Correo electrónico');
    await expect(email).toBeFocused();
    await expect(page.getByTestId('account-form')).toContainText(
      'No puedes usar este correo. Ingresa otro.',
    );
    await expect(page.getByTestId('session-user')).toHaveText('Persona Sintética');
    expect(account.state.email).toBe('persona@example.com');

    // Otro correo es un intento nuevo, con otra clave.
    await email.fill('libre@example.com');
    await button(page, 'Guardar datos personales').click();
    await expect(page.getByTestId('account-email')).toHaveText('libre@example.com');
    const keys = await Promise.all(
      account.requests.map((request) => request.headerValue('idempotency-key')),
    );
    expect(keys[1]).not.toBe(keys[0]);
  });

  test('CA4: un cambio desde otra pestaña no se sobrescribe y se muestran los valores vigentes', async ({
    page,
  }) => {
    await loginAs(page);
    // A carga antes de que B inicie sesión: la cookie de renovación es del contexto y
    // el ingreso de B la reemplaza; A conserva su sesión en memoria.
    await openProfile(page, 'deportista');
    const other = await page.context().newPage();
    await simulateSession(other, sessionFor('athlete'));
    await login(other);
    await expect(other).toHaveURL(/\/deportista\/inicio$/);
    await other.goto('/deportista/perfil');
    await expect(other.getByTestId('account-full-name')).toHaveText('Persona Sintética');

    await editAccount(page, 'Persona Primera', 'persona@example.com');
    await expect(page.getByTestId('account-full-name')).toHaveText('Persona Primera');

    await editAccount(other, 'Persona Segunda', 'persona@example.com');

    const conflict = other.getByTestId('account-conflict');
    await expect(conflict).toBeFocused();
    await expect(conflict).toContainText('No sobrescribimos nada');
    await expect(other.getByTestId('account-full-name')).toHaveText('Persona Primera');
    await expect(other.getByTestId('account-form')).toHaveCount(0);
  });

  test('422: las reglas del backend se marcan junto al campo', async ({ page }) => {
    const { account } = await loginAs(page);
    account.next.push(PUT_ACCOUNT_RESPONSES.validationError);
    await openProfile(page, 'deportista');

    await editAccount(page, 'Persona Renombrada', 'persona.nueva@example.com');

    const summary = page.getByTestId('account-errors');
    await expect(summary).toBeFocused();
    await expect(summary).toContainText('Nombre completo: La longitud no es válida.');
    await expect(summary).toContainText('Correo electrónico: El valor no es válido.');
    await expect(page.getByTestId('account-full-name')).toHaveCount(0);
  });

  test('CA5: un fallo transitorio se reintenta con la misma clave y no repite el cambio', async ({
    page,
  }) => {
    const { account } = await loginAs(page);
    account.next.push(PUT_ACCOUNT_RESPONSES.upstreamUnavailable);
    await openProfile(page, 'deportista');

    await editAccount(page, 'Persona Renombrada', 'persona@example.com');

    await expect(page.getByTestId('account-full-name')).toHaveText('Persona Renombrada', {
      timeout: 10_000,
    });
    const keys = await Promise.all(
      account.requests.map((request) => request.headerValue('idempotency-key')),
    );
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
    expect(account.state.version).toBe(2);
  });

  test('la cuenta aún no proyectada (404) se informa y se puede reintentar', async ({ page }) => {
    const { account } = await loginAs(page, 'organizer');
    account.nextReads.push({
      status: 404,
      body: { code: 'user_not_found', message: 'x', correlation_id: null, details: [] },
    });

    await page.locator('mat-sidenav [data-menu-item="profile"]').click();
    await expect(page.getByTestId('account-not-projected')).toContainText(
      'aún se están preparando',
    );
    await button(page, 'Reintentar').click();
    await expect(page.getByTestId('account-email')).toHaveText('persona@example.com');
  });
});
