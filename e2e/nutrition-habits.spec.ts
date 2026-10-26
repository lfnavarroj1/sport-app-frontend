import { Page, Request, expect, test } from '@playwright/test';

import {
  NUTRITION_HABITS_PATH,
  NUTRITION_HABITS_RESPONSES,
  NUTRITION_HABITS_SECTION,
  SIMULATED_HEALTH_CONSENT_VERSION,
} from '../src/testing/bff-web/profile.fixtures';
import { ProfileSimulation, simulateProfile } from './support/profile-simulator';
import { login, sessionFor, simulateSession } from './support/session-simulator';

/**
 * HU009 Registrar hábitos alimenticios: el deportista los registra en la sección
 * «Hábitos alimenticios» de `/deportista/perfil`, con el consentimiento de datos
 * de salud (ADR-035). El BFF está reemplazado por el simulador del contrato
 * bff-web 0.21.0. NO es E2E integrado.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Inicia sesión como `actorType`; el perfil simulado se comparte entre las pestañas del contexto. */
async function loginAs(page: Page, actorType = 'athlete'): Promise<ProfileSimulation> {
  await simulateSession(page, sessionFor(actorType));
  const simulation = await simulateProfile(page.context());
  await login(page);
  // El ingreso termina al llegar al inicio del actor: navegar antes perdería la sesión.
  await expect(page).toHaveURL(/\/(deportista|profesional|organizador)\/inicio$/);
  return simulation;
}

const commands = (simulation: ProfileSimulation): Request[] =>
  simulation.requests.filter(
    (request) => new URL(request.url()).pathname === NUTRITION_HABITS_PATH,
  );

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const form = (page: Page) => page.getByTestId('nutrition-habits-form');

async function choose(page: Page, label: string, option: string): Promise<void> {
  // Se pulsa el campo completo: la etiqueta de un `mat-select` vacío cubre el disparador.
  await form(page)
    .locator('mat-form-field', { has: page.getByLabel(label, { exact: true }) })
    .click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

/** Llena los hábitos del ejemplo; las casillas se marcan fuera del orden del catálogo. */
async function fillHabits(page: Page): Promise<void> {
  await choose(page, 'Patrón alimentario', 'Vegetariano');
  await choose(page, 'Comidas por día', '4');
  await form(page).getByLabel('Hidratación diaria (opcional)').fill('2,5');
  await form(page).getByRole('checkbox', { name: 'Bajo en azúcar' }).check();
  await form(page).getByRole('checkbox', { name: 'Sin lactosa' }).check();
  await form(page).getByRole('checkbox', { name: 'Mariscos' }).check();
  await form(page).getByRole('checkbox', { name: 'Maní' }).check();
}

async function acceptConsent(page: Page): Promise<void> {
  await form(page)
    .getByRole('checkbox', { name: /Acepto que SportApp trate mis datos de salud/ })
    .check();
}

async function openProfile(page: Page): Promise<void> {
  await page.locator('mat-sidenav [data-menu-item="profile"]').click();
  await expect(page).toHaveURL(/\/deportista\/perfil$/);
}

test.describe('HU009 Hábitos alimenticios (simulador del contrato) @simulado', () => {
  test('CA1: registra con el consentimiento, ve los confirmados y los recupera al recargar', async ({
    page,
  }) => {
    const simulation = await loginAs(page);
    await openProfile(page);

    const section = page.getByTestId('profile-hu009');
    await expect(section.getByRole('heading', { level: 2 })).toHaveText('Hábitos alimenticios');
    await expect(page.getByTestId('nutrition-habits-empty')).toContainText(
      'Aún no has registrado tus hábitos alimenticios.',
    );

    await button(page, 'Registrar hábitos alimenticios').click();
    await fillHabits(page);
    await expect(form(page).getByTestId('nutrition-habits-disclaimer')).toContainText(
      'ni sustituye la valoración de un profesional de la salud',
    );
    // Sin el consentimiento no se puede guardar.
    await expect(button(page, 'Guardar hábitos alimenticios')).toBeDisabled();
    await acceptConsent(page);
    await button(page, 'Guardar hábitos alimenticios').click();

    await expect(page.getByTestId('nutrition-habits-saved')).toHaveText(
      'Registramos tus hábitos alimenticios.',
    );
    await expect(page.getByTestId('nutrition-habits-pattern')).toHaveText('Vegetariano');
    await expect(page.getByTestId('nutrition-habits-restrictions')).toHaveText(
      /Sin lactosa\s*Bajo en azúcar/,
    );
    await expect(page.getByTestId('nutrition-habits-allergies')).toHaveText(/Maní\s*Mariscos/);
    await expect(page.getByTestId('nutrition-habits-meals')).toHaveText('4');
    await expect(page.getByTestId('nutrition-habits-hydration')).toHaveText('2,5 L por día');

    const requests = commands(simulation);
    expect(requests).toHaveLength(1);
    expect(await requests[0].headerValue('authorization')).toMatch(/^Bearer \S+$/);
    expect(await requests[0].headerValue('idempotency-key')).toMatch(UUID);
    // Sin `expected_version` (no existía) ni `user_id`; listas en el orden del catálogo.
    expect(requests[0].postDataJSON()).toEqual({
      consent: { version: SIMULATED_HEALTH_CONSENT_VERSION },
      diet_pattern: 'VEGETARIAN',
      restrictions: ['LACTOSE_FREE', 'LOW_SUGAR'],
      allergies: ['PEANUTS', 'SHELLFISH'],
      meals_per_day: 4,
      hydration_liters_per_day: '2.5',
    });

    // Tras recargar, los hábitos llegan de la consulta del perfil.
    await page.reload();
    await expect(page.getByTestId('nutrition-habits-pattern')).toHaveText('Vegetariano');
    await expect(page.getByTestId('nutrition-habits-hydration')).toHaveText('2,5 L por día');

    // Reemplazar: el consentimiento vuelve a pedirse y se envía la versión mostrada.
    await button(page, 'Editar hábitos alimenticios').click();
    await expect(button(page, 'Guardar hábitos alimenticios')).toBeDisabled();
    await form(page).getByRole('checkbox', { name: 'Maní' }).uncheck();
    await form(page).getByRole('checkbox', { name: 'Mariscos' }).uncheck();
    await form(page).getByLabel('Hidratación diaria (opcional)').fill('');
    await acceptConsent(page);
    await button(page, 'Guardar hábitos alimenticios').click();

    await expect(page.getByTestId('nutrition-habits-saved')).toHaveText(
      'Actualizamos tus hábitos alimenticios.',
    );
    await expect(page.getByTestId('nutrition-habits-allergies')).toHaveText('Ninguna');
    await expect(page.getByTestId('nutrition-habits-hydration')).toHaveText('Sin especificar');
    const replace = commands(simulation)[1].postDataJSON();
    expect(replace.expected_version).toBe(1);
    expect(replace.allergies).toEqual([]);
    expect(replace.hydration_liters_per_day).toBeNull();
  });

  test('CA2: un 422 del backend se marca en su campo y no se guarda nada', async ({ page }) => {
    const simulation = await loginAs(page);
    await openProfile(page);
    simulation.next.push(NUTRITION_HABITS_RESPONSES.validationError);
    await button(page, 'Registrar hábitos alimenticios').click();
    await fillHabits(page);
    await acceptConsent(page);
    await button(page, 'Guardar hábitos alimenticios').click();

    const errors = page.getByTestId('nutrition-habits-errors');
    await expect(errors).toBeFocused();
    await expect(errors.getByRole('listitem')).toHaveText([
      'Alergias alimentarias: Hay valores repetidos.',
      'Comidas por día: El valor está fuera del rango permitido.',
      'Hidratación diaria (opcional): Tiene más decimales de los permitidos.',
    ]);
    await expect(page.getByTestId('nutrition-habits-allergies-error')).toHaveText(
      'Hay valores repetidos.',
    );
    await expect(page.getByTestId('nutrition-habits-saved')).toHaveCount(0);
    expect(simulation.state.nutritionHabits).toBeNull();
  });

  test('CA2: un consentimiento no vigente se explica junto a la casilla', async ({ page }) => {
    const simulation = await loginAs(page);
    await openProfile(page);
    simulation.next.push(NUTRITION_HABITS_RESPONSES.unsupportedConsentVersion);
    await button(page, 'Registrar hábitos alimenticios').click();
    await fillHabits(page);
    await acceptConsent(page);
    await button(page, 'Guardar hábitos alimenticios').click();

    await expect(page.getByTestId('nutrition-habits-consent-error')).toContainText(
      'La versión del consentimiento ya no está vigente.',
    );
    expect(simulation.state.nutritionHabits).toBeNull();
  });

  test('CA6: un reemplazo con una versión vieja no sobrescribe y muestra los vigentes', async ({
    page,
  }) => {
    const simulation = await loginAs(page);
    simulation.state.nutritionHabits = NUTRITION_HABITS_SECTION;
    // A carga antes de que B inicie sesión: la cookie de renovación es del contexto y
    // el ingreso de B la reemplaza; A conserva su sesión en memoria.
    await page.goto('/deportista/perfil');
    await expect(page.getByTestId('nutrition-habits-pattern')).toHaveText('Vegetariano');
    const other = await page.context().newPage();
    await simulateSession(other, sessionFor('athlete'));
    await login(other);
    await expect(other).toHaveURL(/\/deportista\/inicio$/);
    await other.goto('/deportista/perfil');
    await expect(other.getByTestId('nutrition-habits-pattern')).toHaveText('Vegetariano');

    await button(page, 'Editar hábitos alimenticios').click();
    await choose(page, 'Patrón alimentario', 'Vegano');
    await acceptConsent(page);
    await button(page, 'Guardar hábitos alimenticios').click();
    await expect(page.getByTestId('nutrition-habits-pattern')).toHaveText('Vegano');

    await button(other, 'Editar hábitos alimenticios').click();
    await choose(other, 'Comidas por día', '6');
    await acceptConsent(other);
    await button(other, 'Guardar hábitos alimenticios').click();

    await expect(other.getByTestId('nutrition-habits-conflict')).toContainText(
      'no se sobrescribieron',
    );
    await expect(other.getByTestId('nutrition-habits-pattern')).toHaveText('Vegano');
    await expect(other.getByTestId('nutrition-habits-meals')).toHaveText('4');
    expect(commands(simulation).map((request) => request.postDataJSON().expected_version)).toEqual([
      1, 1,
    ]);
    expect(simulation.state.nutritionHabits?.version).toBe(2);
  });

  test('CA6: ante un 503 reintenta con la misma clave y confirma un único registro', async ({
    page,
  }) => {
    const simulation = await loginAs(page);
    await openProfile(page);
    simulation.next.push(NUTRITION_HABITS_RESPONSES.upstreamUnavailable);
    await button(page, 'Registrar hábitos alimenticios').click();
    await fillHabits(page);
    await acceptConsent(page);
    await button(page, 'Guardar hábitos alimenticios').click();

    await expect(page.getByTestId('nutrition-habits-saved')).toHaveText(
      'Registramos tus hábitos alimenticios.',
    );
    const requests = commands(simulation);
    expect(requests).toHaveLength(2);
    expect(await requests[1].headerValue('idempotency-key')).toBe(
      await requests[0].headerValue('idempotency-key'),
    );
    expect(simulation.state.nutritionHabits?.version).toBe(1);
  });

  test('CA4: un profesional no entra al perfil del deportista', async ({ page }) => {
    const simulation = await loginAs(page, 'service_provider');
    await page.goto('/deportista/perfil');

    await expect(page).toHaveURL(/\/acceso-no-autorizado$/);
    expect(simulation.reads).toHaveLength(0);
  });
});
