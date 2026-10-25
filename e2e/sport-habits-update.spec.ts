import { Page, Request, expect, test } from '@playwright/test';

import {
  SPORT_HABITS_PATCH_RESPONSES,
  SPORT_HABITS_PATH,
  SPORT_HABITS_SECTION,
} from '../src/testing/bff-web/profile.fixtures';
import { ProfileSimulation, simulateProfile } from './support/profile-simulator';
import { login, sessionFor, simulateSession } from './support/session-simulator';

/**
 * HU008 Actualizar hábitos deportivos: en el modo edición de la sección
 * «Hábitos deportivos» de `/deportista/perfil` el deportista cambia los deportes,
 * la disponibilidad o el objetivo por separado y solo viajan las secciones
 * modificadas (`PATCH /v1/me/sport-habits`, ADR-035). El BFF está reemplazado por
 * el simulador del contrato bff-web 0.30.0. NO es E2E integrado.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Inicia sesión como deportista con los hábitos de la versión 1 ya registrados (HU006). */
async function loginWithHabits(page: Page): Promise<ProfileSimulation> {
  await simulateSession(page, sessionFor('athlete'));
  const simulation = await simulateProfile(page.context());
  simulation.state.sportHabits = SPORT_HABITS_SECTION;
  await login(page);
  // El ingreso termina al llegar al inicio del actor: navegar antes perdería la sesión.
  await expect(page).toHaveURL(/\/deportista\/inicio$/);
  return simulation;
}

const patches = (simulation: ProfileSimulation): Request[] =>
  simulation.requests.filter(
    (request) =>
      new URL(request.url()).pathname === SPORT_HABITS_PATH && request.method() === 'PATCH',
  );

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const row = (page: Page, index: number) => page.getByTestId(`sport-row-${index}`);

async function openEditor(page: Page): Promise<void> {
  await page.goto('/deportista/perfil');
  await expect(page.getByTestId('sport-habit-0')).toContainText('3 veces por semana');
  await button(page, 'Editar hábitos deportivos').click();
  await expect(page.getByTestId('sport-habits-partial-hint')).toContainText(
    'las demás se conservan',
  );
}

async function chooseGoal(page: Page, option: string): Promise<void> {
  await page
    .locator('mat-form-field', { has: page.getByLabel('Objetivo principal (opcional)') })
    .click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

test.describe('HU008 Actualizar hábitos deportivos (simulador del contrato) @simulado', () => {
  test('CA1: edita un deporte sin perder la disponibilidad ni el objetivo', async ({ page }) => {
    const simulation = await loginWithHabits(page);
    await openEditor(page);

    await row(page, 0).getByLabel('Veces por semana').fill('4');
    await button(page, 'Guardar hábitos deportivos').click();

    const saved = page.getByTestId('sport-habits-saved');
    await expect(saved).toBeFocused();
    await expect(saved).toContainText('Actualizamos tus hábitos deportivos.');
    await expect(page.getByTestId('sport-habits-updated-sections')).toHaveText('Deportes');
    await expect(saved).toContainText('Lo que no cambiaste se conservó.');
    await expect(page.getByTestId('sport-habit-0')).toContainText('4 veces por semana');
    await expect(page.getByTestId('sport-habits-days')).toHaveText(/Lunes\s*Miércoles\s*Sábado/);
    await expect(page.getByTestId('sport-habits-goal')).toHaveText('Salud');

    const requests = patches(simulation);
    expect(requests).toHaveLength(1);
    expect(await requests[0].headerValue('authorization')).toMatch(/^Bearer \S+$/);
    expect(await requests[0].headerValue('idempotency-key')).toMatch(UUID);
    // Solo la sección modificada y la versión vigente; nunca `user_id`.
    expect(requests[0].postDataJSON()).toEqual({
      expected_version: 1,
      sports: [
        { ...SPORT_HABITS_SECTION.sports[0], frequency_per_week: 4 },
        SPORT_HABITS_SECTION.sports[1],
      ],
    });

    await page.reload();
    await expect(page.getByTestId('sport-habit-0')).toContainText('4 veces por semana');
    await expect(page.getByTestId('sport-habit-1')).toContainText('Natación');
    await expect(page.getByTestId('sport-habits-days')).toHaveText(/Lunes\s*Miércoles\s*Sábado/);
    await expect(page.getByTestId('sport-habits-time-slots')).toHaveText('Mañana');
    expect(simulation.state.sportHabits).toEqual(expect.objectContaining({ version: 2 }));
  });

  test('CA1: borra solo el objetivo y conserva deportes y disponibilidad', async ({ page }) => {
    const simulation = await loginWithHabits(page);
    await openEditor(page);

    await chooseGoal(page, 'Sin especificar');
    await button(page, 'Guardar hábitos deportivos').click();

    await expect(page.getByTestId('sport-habits-updated-sections')).toHaveText(
      'Objetivo principal',
    );
    await expect(page.getByTestId('sport-habits-goal')).toHaveText('Sin especificar');
    await expect(page.getByTestId('sport-habit-1')).toContainText('Natación');
    expect(patches(simulation).map((request) => request.postDataJSON())).toEqual([
      { expected_version: 1, primary_goal: null },
    ]);
  });

  test('CA5: sin cambios no envía nada y lo explica', async ({ page }) => {
    const simulation = await loginWithHabits(page);
    await openEditor(page);

    await button(page, 'Guardar hábitos deportivos').click();

    await expect(page.getByTestId('sport-habits-unchanged')).toBeFocused();
    await expect(page.getByTestId('sport-habits-unchanged')).toHaveText(
      'No cambiaste ningún dato: no hay nada que guardar.',
    );
    expect(patches(simulation)).toHaveLength(0);
  });

  test('CA2: conflicto desde dos pestañas no sobrescribe y muestra los valores vigentes', async ({
    page,
  }) => {
    const simulation = await loginWithHabits(page);
    // A carga antes de que B inicie sesión: la cookie de renovación es del contexto y
    // el ingreso de B la reemplaza; A conserva su sesión en memoria.
    await page.goto('/deportista/perfil');
    await expect(page.getByTestId('sport-habit-0')).toContainText('3 veces por semana');
    const other = await page.context().newPage();
    await simulateSession(other, sessionFor('athlete'));
    await login(other);
    await expect(other).toHaveURL(/\/deportista\/inicio$/);
    await other.goto('/deportista/perfil');
    await expect(other.getByTestId('sport-habit-0')).toContainText('3 veces por semana');

    // La pestaña A cambia un deporte sobre la versión 1.
    await button(page, 'Editar hábitos deportivos').click();
    await row(page, 0).getByLabel('Veces por semana').fill('5');
    await button(page, 'Guardar hábitos deportivos').click();
    await expect(page.getByTestId('sport-habits-updated-sections')).toHaveText('Deportes');

    // La pestaña B aún muestra la versión 1 y cambia otra sección: tampoco se sobrescribe.
    await button(other, 'Editar hábitos deportivos').click();
    await other.getByRole('checkbox', { name: 'Martes' }).check();
    await button(other, 'Guardar hábitos deportivos').click();

    const conflict = other.getByTestId('sport-habits-conflict');
    await expect(conflict).toBeFocused();
    await expect(conflict).toContainText('cambiaron en otra sesión y no se sobrescribieron');
    await expect(other.getByTestId('sport-habit-0')).toContainText('5 veces por semana');
    await expect(other.getByTestId('sport-habits-days')).not.toContainText('Martes');
    await expect(other.getByTestId('sport-habits-saved')).toHaveCount(0);

    expect(patches(simulation).map((request) => request.postDataJSON().expected_version)).toEqual([
      1, 1,
    ]);
    expect(simulation.state.sportHabits).toEqual(expect.objectContaining({ version: 2 }));
    expect((simulation.state.sportHabits?.['availability'] as { days: string[] }).days).toEqual([
      'MON',
      'WED',
      'SAT',
    ]);
  });

  test('CA5: las reglas del backend se marcan por campo e índice y no se guarda nada', async ({
    page,
  }) => {
    const simulation = await loginWithHabits(page);
    simulation.next.push(SPORT_HABITS_PATCH_RESPONSES.validationError);
    await openEditor(page);

    await row(page, 1).getByLabel('Veces por semana').fill('2');
    await button(page, 'Guardar hábitos deportivos').click();

    const errors = page.getByTestId('sport-habits-errors');
    await expect(errors).toBeFocused();
    await expect(errors).toContainText('Deporte 2 (deporte): Este deporte ya está en otra fila.');
    await expect(errors).toContainText('Franjas horarias: El valor no es válido.');
    await expect(page.getByTestId('sport-habits-saved')).toHaveCount(0);
    expect(simulation.state.sportHabits?.version).toBe(1);
  });

  test('CA3: ante 503 reintenta con la misma clave y guarda una única versión', async ({
    page,
  }) => {
    const simulation = await loginWithHabits(page);
    simulation.next.push(SPORT_HABITS_PATCH_RESPONSES.upstreamUnavailable);
    await openEditor(page);

    await page.getByRole('checkbox', { name: 'Viernes' }).check();
    await button(page, 'Guardar hábitos deportivos').click();

    await expect(page.getByTestId('sport-habits-retrying')).toContainText('Reintentando');
    await expect(page.getByTestId('sport-habits-saved')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('sport-habits-updated-sections')).toHaveText('Disponibilidad');
    const requests = patches(simulation);
    expect(requests).toHaveLength(2);
    const keys = await Promise.all(
      requests.map((request) => request.headerValue('idempotency-key')),
    );
    expect(new Set(keys).size).toBe(1);
    expect(simulation.state.sportHabits?.version).toBe(2);
  });
});
