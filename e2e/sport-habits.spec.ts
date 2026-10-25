import { Page, Request, expect, test } from '@playwright/test';

import {
  SPORT_HABITS_PATH,
  SPORT_HABITS_RESPONSES,
  SPORT_HABITS_SECTION,
} from '../src/testing/bff-web/profile.fixtures';
import { ProfileSimulation, simulateProfile } from './support/profile-simulator';
import { login, sessionFor, simulateSession } from './support/session-simulator';

/**
 * HU006 Registrar hábitos deportivos: el deportista los registra en la sección
 * «Hábitos deportivos» de `/deportista/perfil` (ADR-034). El BFF está
 * reemplazado por el simulador del contrato bff-web 0.19.0. NO es E2E integrado.
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
  simulation.requests.filter((request) => new URL(request.url()).pathname === SPORT_HABITS_PATH);

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const row = (page: Page, index: number) => page.getByTestId(`sport-row-${index}`);

async function choose(page: Page, index: number, label: string, option: string): Promise<void> {
  // Se pulsa el campo completo, como una persona: la etiqueta de un `mat-select` vacío
  // cubre el disparador y `mat-form-field` reenvía el clic al control.
  await row(page, index)
    .locator('mat-form-field', { has: page.getByLabel(label, { exact: true }) })
    .click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

async function fillSport(
  page: Page,
  index: number,
  values: { sport: string; frequency: string; duration: string; intensity: string; level: string },
): Promise<void> {
  await choose(page, index, 'Deporte', values.sport);
  await row(page, index).getByLabel('Veces por semana').fill(values.frequency);
  await row(page, index).getByLabel('Duración por sesión (min)').fill(values.duration);
  await choose(page, index, 'Intensidad', values.intensity);
  await choose(page, index, 'Nivel', values.level);
}

async function fillHabits(page: Page): Promise<void> {
  await fillSport(page, 0, {
    sport: 'Carrera',
    frequency: '3',
    duration: '45',
    intensity: 'Moderada',
    level: 'Intermedio',
  });
  await row(page, 0).getByLabel('Años practicándolo (opcional)').fill('4');
  await button(page, 'Agregar deporte').click();
  await fillSport(page, 1, {
    sport: 'Natación',
    frequency: '1',
    duration: '60',
    intensity: 'Baja',
    level: 'Principiante',
  });
  // Marcados fuera de orden: el cuerpo viaja en el orden del catálogo.
  await page.getByRole('checkbox', { name: 'Sábado' }).check();
  await page.getByRole('checkbox', { name: 'Lunes' }).check();
  await page.getByRole('checkbox', { name: 'Miércoles' }).check();
  await page.getByRole('checkbox', { name: 'Mañana' }).check();
  await page
    .locator('mat-form-field', { has: page.getByLabel('Objetivo principal (opcional)') })
    .click();
  await page.getByRole('option', { name: 'Salud', exact: true }).click();
}

test.describe('HU006 Hábitos deportivos (simulador del contrato) @simulado', () => {
  test('CA1: desde «Mi perfil» registra los hábitos, ve los confirmados y los recupera al recargar', async ({
    page,
  }) => {
    const simulation = await loginAs(page);
    await page.locator('mat-sidenav [data-menu-item="profile"]').click();
    await expect(page).toHaveURL(/\/deportista\/perfil$/);

    const section = page.getByTestId('profile-hu006');
    await expect(section.getByRole('heading', { level: 2 })).toHaveText('Hábitos deportivos');
    await expect(page.getByTestId('sport-habits-empty')).toContainText(
      'Aún no has registrado tus hábitos deportivos.',
    );

    await button(page, 'Registrar hábitos deportivos').click();
    await fillHabits(page);
    await button(page, 'Guardar hábitos deportivos').click();

    await expect(page.getByTestId('sport-habits-saved')).toHaveText(
      'Registramos tus hábitos deportivos.',
    );
    await expect(page.getByTestId('sport-habit-0')).toContainText('Carrera');
    await expect(page.getByTestId('sport-habit-0')).toContainText('3 veces por semana');
    await expect(page.getByTestId('sport-habit-1')).toContainText('Natación');
    await expect(page.getByTestId('sport-habits-days')).toHaveText(/Lunes\s*Miércoles\s*Sábado/);
    await expect(page.getByTestId('sport-habits-goal')).toHaveText('Salud');

    const requests = commands(simulation);
    expect(requests).toHaveLength(1);
    expect(await requests[0].headerValue('authorization')).toMatch(/^Bearer \S+$/);
    expect(await requests[0].headerValue('idempotency-key')).toMatch(UUID);
    // Sin `expected_version` (no existía) ni `user_id`; días en el orden del catálogo.
    expect(requests[0].postDataJSON()).toEqual({
      sports: SPORT_HABITS_SECTION.sports,
      availability: SPORT_HABITS_SECTION.availability,
      primary_goal: 'HEALTH',
    });

    const reads = simulation.reads.length;
    await page.reload();
    await expect(page.getByTestId('sport-habit-1')).toContainText('Natación');
    await expect(page.getByTestId('sport-habits-saved')).toHaveCount(0);
    expect(simulation.reads.length).toBeGreaterThan(reads);
  });

  test('CA2: no ofrece un deporte repetido ni una sexta fila', async ({ page }) => {
    await loginAs(page);
    await page.goto('/deportista/perfil');
    await button(page, 'Registrar hábitos deportivos').click();
    await choose(page, 0, 'Deporte', 'Carrera');

    for (let count = 1; count < 5; count++) {
      await button(page, 'Agregar deporte').click();
    }
    await expect(page.locator('[data-testid^="sport-row-"] legend')).toHaveCount(5);
    await expect(button(page, 'Agregar deporte')).toBeDisabled();
    await expect(page.getByTestId('sport-habits-max')).toHaveText(
      'Ya agregaste el máximo de 5 deportes.',
    );

    await row(page, 1)
      .locator('mat-form-field', { has: page.getByLabel('Deporte', { exact: true }) })
      .click();
    await expect(page.getByRole('option', { name: 'Carrera', exact: true })).toBeDisabled();
    await expect(page.getByRole('option', { name: 'Ciclismo', exact: true })).toBeEnabled();
  });

  test('CA2: las reglas del backend se marcan en la fila y el campo, y no se guarda nada', async ({
    page,
  }) => {
    const simulation = await loginAs(page);
    simulation.next.push(SPORT_HABITS_RESPONSES.validationError);
    await page.goto('/deportista/perfil');
    await button(page, 'Registrar hábitos deportivos').click();
    await fillHabits(page);
    await button(page, 'Guardar hábitos deportivos').click();

    const errors = page.getByTestId('sport-habits-errors');
    await expect(errors).toBeFocused();
    await expect(errors).toContainText('Deporte 2 (deporte): Este deporte ya está en otra fila.');
    await expect(errors).toContainText(
      'Deporte 1 (veces por semana): El valor está fuera del rango permitido.',
    );
    await expect(errors).toContainText('Días disponibles: Hay valores repetidos.');
    await expect(row(page, 0).getByLabel('Veces por semana')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await expect(page.getByTestId('sport-habits-saved')).toHaveCount(0);
    expect(simulation.state.sportHabits).toBeNull();
  });

  test('CA4: un reemplazo con una versión vieja desde otra pestaña no sobrescribe', async ({
    page,
  }) => {
    const simulation = await loginAs(page);
    simulation.state.sportHabits = SPORT_HABITS_SECTION;
    // A carga antes de que B inicie sesión: la cookie de renovación es del contexto y
    // el ingreso de B la reemplaza; A conserva su sesión en memoria.
    await page.goto('/deportista/perfil');
    await expect(page.getByTestId('sport-habit-0')).toContainText('Carrera');
    const other = await page.context().newPage();
    await simulateSession(other, sessionFor('athlete'));
    await login(other);
    await expect(other).toHaveURL(/\/deportista\/inicio$/);
    await other.goto('/deportista/perfil');
    await expect(other.getByTestId('sport-habit-0')).toContainText('3 veces por semana');

    // La pestaña A reemplaza la versión 1.
    await button(page, 'Editar hábitos deportivos').click();
    await row(page, 0).getByLabel('Veces por semana').fill('5');
    await button(page, 'Guardar hábitos deportivos').click();
    // Desde HU008 la edición envía solo los deportes (PATCH); la confirmación los lista.
    await expect(page.getByTestId('sport-habits-saved')).toContainText(
      'Actualizamos tus hábitos deportivos.',
    );

    // La pestaña B aún muestra la versión 1 e intenta reemplazarla.
    await button(other, 'Editar hábitos deportivos').click();
    await row(other, 0).getByLabel('Veces por semana').fill('2');
    await button(other, 'Guardar hábitos deportivos').click();

    await expect(other.getByTestId('sport-habits-conflict')).toContainText(
      'cambiaron en otra sesión y no se sobrescribieron',
    );
    await expect(other.getByTestId('sport-habit-0')).toContainText('5 veces por semana');
    await expect(other.getByTestId('sport-habits-saved')).toHaveCount(0);

    expect(commands(simulation).map((request) => request.postDataJSON().expected_version)).toEqual([
      1, 1,
    ]);
    expect(simulation.state.sportHabits).toEqual(expect.objectContaining({ version: 2 }));
  });

  test('CA4: ante 503 reintenta con la misma clave y guarda una única versión', async ({
    page,
  }) => {
    const simulation = await loginAs(page);
    simulation.next.push(
      SPORT_HABITS_RESPONSES.upstreamUnavailable,
      SPORT_HABITS_RESPONSES.upstreamTimeout,
    );
    await page.goto('/deportista/perfil');
    await button(page, 'Registrar hábitos deportivos').click();
    await fillHabits(page);
    await button(page, 'Guardar hábitos deportivos').click();

    await expect(page.getByTestId('sport-habits-retrying')).toContainText('Reintentando');
    await expect(page.getByTestId('sport-habits-saved')).toBeVisible({ timeout: 15_000 });
    const requests = commands(simulation);
    expect(requests).toHaveLength(3);
    const keys = await Promise.all(
      requests.map((request) => request.headerValue('idempotency-key')),
    );
    expect(new Set(keys).size).toBe(1);
    expect(simulation.state.sportHabits?.version).toBe(1);
  });

  test('CA5: el profesional no tiene perfil de deportista', async ({ page }) => {
    const simulation = await loginAs(page, 'service_provider');

    await page.goto('/deportista/perfil');
    await expect(page).toHaveURL(/\/acceso-no-autorizado$/);
    expect(simulation.reads).toHaveLength(0);
    expect(commands(simulation)).toHaveLength(0);
  });
});
