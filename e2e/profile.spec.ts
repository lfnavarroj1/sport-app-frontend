import { Page, Request, expect, test } from '@playwright/test';

import {
  DEMOGRAPHIC_PROFILE_PATH,
  DEMOGRAPHIC_RESPONSES,
  DEMOGRAPHIC_SECTION,
  PHYSIOLOGICAL_PROFILE_PATH,
  PHYSIOLOGICAL_RESPONSES,
  VALID_DEMOGRAPHIC_REQUEST,
} from '../src/testing/bff-web/profile.fixtures';
import { ProfileSimulation, simulateProfile } from './support/profile-simulator';
import { login, sessionFor, simulateSession } from './support/session-simulator';

/**
 * HU005 Registrar datos demográficos y fisiológicos: el deportista los registra
 * en `/deportista/perfil` (ADR-034). El BFF está reemplazado por el simulador
 * del contrato bff-web 0.13.0. NO es E2E integrado.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MEASURED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/** Inicia sesión como `actorType`; el perfil simulado se comparte entre las pestañas del contexto. */
async function loginAs(page: Page, actorType = 'athlete'): Promise<ProfileSimulation> {
  await simulateSession(page, sessionFor(actorType));
  const simulation = await simulateProfile(page.context());
  await login(page);
  // El ingreso termina al llegar al inicio del actor: navegar antes perdería la sesión.
  await expect(page).toHaveURL(/\/(deportista|profesional|organizador)\/inicio$/);
  return simulation;
}

/** Comandos recibidos en una de las dos secciones. */
const commands = (simulation: ProfileSimulation, path: string): Request[] =>
  simulation.requests.filter((request) => new URL(request.url()).pathname === path);

async function choose(page: Page, label: string, option: string): Promise<void> {
  // Se pulsa el campo completo, como una persona: en una fila estrecha la etiqueta de un
  // `mat-select` vacío cubre el disparador y `mat-form-field` reenvía el clic al control.
  await page.locator('mat-form-field', { has: page.getByLabel(label) }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

async function fillDemographic(page: Page): Promise<void> {
  await page.getByLabel('Fecha de nacimiento').fill('1992-04-18');
  await choose(page, 'Género', 'Femenino');
  await page.getByLabel('País de residencia (código)').fill('co');
  await page.getByLabel('Ciudad de residencia').fill('  Bogotá ');
  await choose(page, 'Estado civil (opcional)', 'Soltero o soltera');
  await page.getByLabel('Ocupación (opcional)').fill('Ingeniera');
  await choose(page, 'Rango de ingresos (opcional)', 'Entre 2 y 4 SMMLV');
}

async function fillPhysiological(page: Page): Promise<void> {
  await page.getByLabel('Peso (kg)').fill('68,5');
  await page.getByLabel('Altura (cm)').fill('172');
  await page.getByLabel('Frecuencia cardíaca en reposo (lpm, opcional)').fill('58');
  await page.getByLabel('Presión sistólica (mmHg)').fill('118');
  await page.getByLabel('Presión diastólica (mmHg)').fill('76');
  await page.getByLabel('Temperatura corporal (°C, opcional)').fill('36,6');
}

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const consent = (page: Page) => page.getByLabel(/Acepto que SportApp trate mis datos de salud/);

test.describe('HU005 Datos demográficos y fisiológicos (simulador del contrato) @simulado', () => {
  test('CA1: desde «Mi perfil» registra los datos demográficos y ve la respuesta confirmada', async ({
    page,
  }) => {
    const simulation = await loginAs(page);
    await page.locator('mat-sidenav [data-menu-item="profile"]').click();
    await expect(page).toHaveURL(/\/deportista\/perfil$/);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Mi perfil');
    await expect(page.getByTestId('profile-personal-upcoming')).toContainText('Próximamente');
    await expect(page.getByTestId('profile-habits-upcoming')).toContainText('Próximamente');
    await expect(page.getByTestId('demographic-empty')).toHaveText(
      'Aún no has registrado tus datos demográficos.',
    );
    await expect(page.getByTestId('physiological-empty')).toHaveText(
      'Aún no has registrado tus datos fisiológicos.',
    );
    await expect(page.getByTestId('state-error')).toHaveCount(0);

    await button(page, 'Registrar datos demográficos').click();
    await fillDemographic(page);
    await expect(page.getByTestId('demographic-country-name')).toContainText('Colombia');
    await expect(page.getByTestId('demographic-age')).toBeVisible();
    await button(page, 'Guardar datos demográficos').click();

    await expect(page.getByTestId('demographic-saved')).toHaveText(
      'Registramos tus datos demográficos.',
    );
    const summary = page.getByTestId('demographic-summary');
    await expect(summary).toContainText('18 de abril de 1992');
    await expect(summary).toContainText('Femenino');
    await expect(summary).toContainText('Colombia');
    await expect(summary).toContainText('Bogotá');
    await expect(summary).toContainText('Entre 2 y 4 SMMLV');

    const requests = commands(simulation, DEMOGRAPHIC_PROFILE_PATH);
    expect(requests).toHaveLength(1);
    expect(await requests[0].headerValue('authorization')).toMatch(/^Bearer \S+$/);
    expect(await requests[0].headerValue('idempotency-key')).toMatch(UUID);
    // Sin `expected_version`: la sección no existía.
    expect(requests[0].postDataJSON()).toEqual(VALID_DEMOGRAPHIC_REQUEST);
  });

  test('CA1, CA3 y CA4: registra los fisiológicos tras aceptar el consentimiento y ve el IMC estimado', async ({
    page,
  }) => {
    const logs: string[] = [];
    page.on('console', (message) => logs.push(message.text()));
    const simulation = await loginAs(page);
    await page.goto('/deportista/perfil');

    await button(page, 'Registrar datos fisiológicos').click();
    await fillPhysiological(page);
    const save = button(page, 'Guardar datos fisiológicos');
    await expect(save).toBeDisabled();
    await expect(page.getByTestId('physiological-consent-required')).toBeVisible();

    await consent(page).check();
    await expect(page.getByTestId('physiological-consent-required')).toHaveCount(0);
    await save.click();

    await expect(page.getByTestId('physiological-saved')).toHaveText(
      'Registramos tus datos fisiológicos.',
    );
    await expect(page.getByTestId('physiological-summary')).toContainText('IMC estimado');
    await expect(page.getByTestId('physiological-bmi')).toContainText('23,2');
    await expect(page.getByTestId('physiological-summary')).toContainText('68,5 kg');

    const requests = commands(simulation, PHYSIOLOGICAL_PROFILE_PATH);
    expect(requests).toHaveLength(1);
    expect(await requests[0].headerValue('idempotency-key')).toMatch(UUID);
    // Decimales como texto con punto; `measured_at` en UTC; nunca `bmi` ni `user_id`.
    expect(requests[0].postDataJSON()).toEqual({
      consent: { version: 'local-dev' },
      measured_at: expect.stringMatching(MEASURED_AT),
      weight_kg: '68.5',
      height_cm: 172,
      resting_heart_rate_bpm: 58,
      blood_pressure: { systolic_mmhg: 118, diastolic_mmhg: 76 },
      body_temperature_c: '36.6',
    });

    // CA4: los valores de salud no quedan en consola ni en almacenamiento persistente.
    const stored = await page.evaluate(() =>
      JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }),
    );
    for (const value of ['68.5', '68,5', '23.2', '36.6']) {
      expect(stored).not.toContain(value);
      expect(logs.join('\n')).not.toContain(value);
    }
  });

  test('al recargar la página el perfil se lee desde el BFF', async ({ page }) => {
    const simulation = await loginAs(page);
    await page.goto('/deportista/perfil');
    await button(page, 'Registrar datos demográficos').click();
    await fillDemographic(page);
    await button(page, 'Guardar datos demográficos').click();
    await expect(page.getByTestId('demographic-saved')).toBeVisible();
    const reads = simulation.reads.length;

    await page.reload();

    await expect(page.getByTestId('demographic-summary')).toContainText('Bogotá');
    await expect(page.getByTestId('demographic-saved')).toHaveCount(0);
    await expect(page.getByTestId('physiological-empty')).toBeVisible();
    expect(simulation.reads.length).toBeGreaterThan(reads);
  });

  test('CA2: las reglas incumplidas se marcan en sus campos y nada se guarda', async ({ page }) => {
    const simulation = await loginAs(page);
    simulation.next.push(DEMOGRAPHIC_RESPONSES.validationError);
    await page.goto('/deportista/perfil');
    await button(page, 'Registrar datos demográficos').click();
    await fillDemographic(page);
    await button(page, 'Guardar datos demográficos').click();

    const errors = page.getByTestId('demographic-errors');
    await expect(errors).toBeFocused();
    await expect(errors).toContainText(
      'Fecha de nacimiento: El valor está fuera del rango permitido.',
    );
    await expect(errors).toContainText('País de residencia (código): El valor no es válido.');
    await expect(errors).toContainText('Solicitud: Este dato no se puede enviar.');
    await expect(page.getByLabel('Fecha de nacimiento')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByTestId('demographic-saved')).toHaveCount(0);
    await expect(page.getByTestId('demographic-summary')).toHaveCount(0);
    expect(simulation.state.demographic).toBeNull();
  });

  test('CA3: un consentimiento con otra versión se rechaza indicando qué hacer', async ({
    page,
  }) => {
    const simulation = await loginAs(page);
    simulation.next.push(PHYSIOLOGICAL_RESPONSES.unsupportedConsentVersion);
    await page.goto('/deportista/perfil');
    await button(page, 'Registrar datos fisiológicos').click();
    await fillPhysiological(page);
    await consent(page).check();
    await button(page, 'Guardar datos fisiológicos').click();

    await expect(page.getByTestId('physiological-form')).toContainText(
      'La versión del consentimiento ya no está vigente. Recarga la página y acepta la versión actual para guardar.',
    );
    await expect(page.getByTestId('physiological-saved')).toHaveCount(0);
    expect(simulation.state.physiological).toBeNull();
  });

  test('CA6: un reemplazo con una versión vieja desde otra pestaña no sobrescribe', async ({
    page,
  }) => {
    const simulation = await loginAs(page);
    simulation.state.demographic = DEMOGRAPHIC_SECTION;
    // A carga antes de que B inicie sesión: la cookie de renovación es del contexto y
    // el ingreso de B la reemplaza; A conserva su sesión en memoria.
    await page.goto('/deportista/perfil');
    await expect(page.getByTestId('demographic-summary')).toContainText('Bogotá');
    const other = await page.context().newPage();
    await simulateSession(other, sessionFor('athlete'));
    await login(other);
    await expect(other).toHaveURL(/\/deportista\/inicio$/);
    await other.goto('/deportista/perfil');
    await expect(other.getByTestId('demographic-summary')).toContainText('Bogotá');

    // La pestaña A reemplaza la versión 1.
    await button(page, 'Editar datos demográficos').click();
    await page.getByLabel('Ciudad de residencia').fill('Medellín');
    await button(page, 'Guardar datos demográficos').click();
    await expect(page.getByTestId('demographic-saved')).toHaveText(
      'Actualizamos tus datos demográficos.',
    );

    // La pestaña B aún muestra la versión 1 e intenta reemplazarla.
    await button(other, 'Editar datos demográficos').click();
    await other.getByLabel('Ciudad de residencia').fill('Cali');
    await button(other, 'Guardar datos demográficos').click();

    await expect(other.getByTestId('demographic-conflict')).toContainText(
      'cambiaron en otra sesión y no se sobrescribieron',
    );
    await expect(other.getByTestId('demographic-summary')).toContainText('Medellín');
    await expect(other.getByTestId('demographic-saved')).toHaveCount(0);

    const requests = commands(simulation, DEMOGRAPHIC_PROFILE_PATH);
    expect(requests.map((request) => request.postDataJSON().expected_version)).toEqual([1, 1]);
    expect(simulation.state.demographic).toEqual(
      expect.objectContaining({ version: 2, city: 'Medellín' }),
    );
  });

  test('CA6: ante 503 reintenta con la misma clave y guarda un único registro', async ({
    page,
  }) => {
    const simulation = await loginAs(page);
    simulation.next.push(
      DEMOGRAPHIC_RESPONSES.upstreamUnavailable,
      DEMOGRAPHIC_RESPONSES.upstreamTimeout,
    );
    await page.goto('/deportista/perfil');
    await button(page, 'Registrar datos demográficos').click();
    await fillDemographic(page);
    await button(page, 'Guardar datos demográficos').click();

    await expect(page.getByTestId('demographic-retrying')).toContainText('Reintentando');
    await expect(page.getByTestId('demographic-saved')).toBeVisible({ timeout: 15_000 });
    const requests = commands(simulation, DEMOGRAPHIC_PROFILE_PATH);
    expect(requests).toHaveLength(3);
    const keys = await Promise.all(
      requests.map((request) => request.headerValue('idempotency-key')),
    );
    expect(new Set(keys).size).toBe(1);
    expect(simulation.state.demographic?.version).toBe(1);
  });

  test('CA5: el organizador no tiene perfil de deportista', async ({ page }) => {
    const simulation = await loginAs(page, 'organizer');

    const profile = page.locator('mat-sidenav [data-menu-item="profile"]');
    await expect(profile).toContainText('Próximamente');
    await expect(profile.locator('a, button')).toHaveCount(0);

    await page.goto('/deportista/perfil');
    await expect(page).toHaveURL(/\/acceso-no-autorizado$/);
    expect(simulation.reads).toHaveLength(0);
  });
});
