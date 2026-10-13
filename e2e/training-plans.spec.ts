import { Page, expect, test } from '@playwright/test';

import {
  CREATE_TRAINING_PLAN_RESPONSES,
  GRANT_AUTHORIZATION_RESPONSES,
  SIMULATED_PROFESSIONAL_ID,
} from '../src/testing/bff-web/training.fixtures';
import { login, sessionFor, simulateSession } from './support/session-simulator';
import { TrainingSimulation, simulateTraining } from './support/training-simulator';

/**
 * HU010 Crear plan de entrenamiento: el deportista autoriza a un profesional y el
 * profesional crea, confirma, asigna y consulta el plan. El BFF está reemplazado
 * por el simulador del contrato bff-web 0.6.0. NO es E2E integrado.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function loginAs(page: Page, actorType: string): Promise<TrainingSimulation> {
  await simulateSession(page, sessionFor(actorType));
  const simulation = await simulateTraining(page);
  await login(page);
  return simulation;
}

async function openEditor(page: Page): Promise<void> {
  await page.locator('mat-sidenav [data-menu-item="training-plans"]').click();
  await expect(page).toHaveURL(/\/profesional\/entrenamientos\/planes$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Crear plan de entrenamiento');
}

async function fillPlan(page: Page): Promise<void> {
  await page.getByLabel('Correo del deportista').fill('deportista@example.com');
  await page.getByLabel('Título').fill('Base aeróbica de 8 semanas');
  await page.getByRole('textbox', { name: 'Objetivo 1' }).fill('Mejorar la resistencia aeróbica');
  await page.getByLabel('Fecha de inicio').fill('2026-11-02');
  await page.getByLabel('Fecha de fin').fill('2026-12-27');
  await page.getByLabel('Fecha', { exact: true }).fill('2026-11-03');
  await page.getByLabel('Deporte').click();
  await page.getByRole('option', { name: 'Carrera' }).click();
  await page.getByLabel('Duración (min)').fill('45');
  await page.getByLabel('Intensidad (RPE)').fill('4');
}

async function reviewAndConfirm(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Revisar plan' }).click();
  await expect(page.getByRole('heading', { name: 'Confirma la asignación' })).toBeFocused();
  await page.getByRole('button', { name: 'Confirmar y asignar' }).click();
}

test.describe('HU010 Crear plan de entrenamiento (simulador del contrato) @simulado', () => {
  test('CA1, CA4 y CA5: el profesional revisa, asigna y consulta el plan', async ({ page }) => {
    const simulation = await loginAs(page, 'service_provider');
    await openEditor(page);
    await fillPlan(page);
    await reviewAndConfirm(page);

    const created = page.getByTestId('plan-created');
    await expect(created).toContainText('Plan asignado');
    await expect(created).toContainText(
      'El plan «Base aeróbica de 8 semanas» quedó asignado a deportista@example.com.',
    );
    await expect(created).toContainText('Del 2 de noviembre de 2026 al 27 de diciembre de 2026');
    expect(simulation.creates).toHaveLength(1);
    const request = simulation.creates[0];
    expect(await request.headerValue('authorization')).toMatch(/^Bearer \S+$/);
    expect(await request.headerValue('idempotency-key')).toMatch(UUID);
    expect(request.postDataJSON()).toEqual({
      athlete_email: 'deportista@example.com',
      title: 'Base aeróbica de 8 semanas',
      objectives: ['Mejorar la resistencia aeróbica'],
      start_date: '2026-11-02',
      end_date: '2026-12-27',
      sessions: [
        { scheduled_date: '2026-11-03', sport: 'running', duration_minutes: 45, intensity_rpe: 4 },
      ],
    });

    await created.getByRole('link', { name: 'Consultar el plan' }).click();
    await expect(page).toHaveURL(/\/profesional\/entrenamientos\/planes\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId('plan-summary-title')).toHaveText('Base aeróbica de 8 semanas');
    await expect(page.getByTestId('plan-detail-status')).toHaveText('Asignado');
  });

  test('CA5: tras un fallo del servicio, el reintento usa la misma clave y no duplica', async ({
    page,
  }) => {
    const simulation = await loginAs(page, 'service_provider');
    simulation.nextCreate = CREATE_TRAINING_PLAN_RESPONSES.upstreamUnavailable;
    await openEditor(page);
    await fillPlan(page);
    await reviewAndConfirm(page);

    await expect(page.getByTestId('plan-error')).toContainText('El servicio no está disponible');
    await expect(page.getByTestId('plan-error')).toContainText('Código de referencia');

    await page.getByRole('button', { name: 'Confirmar y asignar' }).click();
    await expect(page.getByTestId('plan-created')).toBeVisible();
    expect(simulation.creates).toHaveLength(2);
    expect(await simulation.creates[1].headerValue('idempotency-key')).toBe(
      await simulation.creates[0].headerValue('idempotency-key'),
    );
  });

  test('CA2: sin autorización del deportista no se asigna y se indica en el correo', async ({
    page,
  }) => {
    const simulation = await loginAs(page, 'service_provider');
    simulation.nextCreate = CREATE_TRAINING_PLAN_RESPONSES.athleteAuthorizationRequired;
    await openEditor(page);
    await fillPlan(page);
    await reviewAndConfirm(page);

    await expect(page.getByRole('heading', { name: 'Datos del plan' })).toBeVisible();
    await expect(page.locator('mat-error')).toContainText(
      'no corresponde a un deportista que te haya autorizado',
    );
    await expect(page.getByTestId('plan-created')).toHaveCount(0);
  });

  test('CA3: las reglas incumplidas se listan y nada se guarda', async ({ page }) => {
    const simulation = await loginAs(page, 'service_provider');
    simulation.nextCreate = CREATE_TRAINING_PLAN_RESPONSES.trainingPlanInvalid;
    await openEditor(page);
    await fillPlan(page);
    await page.getByRole('button', { name: 'Agregar sesión' }).click();
    const second = page.locator('[data-session="1"]');
    await second.getByLabel('Fecha', { exact: true }).fill('2027-01-10');
    await second.getByLabel('Deporte').click();
    await page.getByRole('option', { name: 'Natación' }).click();
    await second.getByLabel('Duración (min)').fill('30');
    await second.getByLabel('Intensidad (RPE)').fill('3');
    await reviewAndConfirm(page);

    const errors = page.getByTestId('plan-errors');
    await expect(errors).toBeFocused();
    await expect(errors.getByRole('listitem')).toHaveText([
      'Fecha de fin: la fecha de fin es anterior a la de inicio.',
      'Fecha de la sesión 2: está fuera del periodo del plan.',
      'Fecha de la sesión 2: hay más sesiones de las permitidas en el mismo día.',
    ]);
    await expect(page.getByTestId('plan-created')).toHaveCount(0);
  });

  test('CA2: el deportista no entra al editor del profesional', async ({ page }) => {
    await loginAs(page, 'athlete');
    await expect(page).toHaveURL(/\/deportista\/inicio$/);

    await page.goto('/profesional/entrenamientos/planes');

    await expect(page).toHaveURL(/\/acceso-no-autorizado$/);
  });

  test('el deportista autoriza a un profesional y luego revoca la autorización', async ({
    page,
  }) => {
    const simulation = await loginAs(page, 'athlete');
    await page.locator('mat-sidenav [data-menu-item="athlete-training-plans"]').click();
    await expect(page).toHaveURL(/\/deportista\/entrenamientos\/planes$/);

    await page.getByLabel('Correo del profesional').fill('profesional@example.com');
    await page.getByRole('button', { name: 'Autorizar', exact: true }).click();

    await expect(page.getByTestId('authorization-notice')).toHaveText(
      'Autorizaste a profesional@example.com. Ya puede asignarte planes de entrenamiento.',
    );
    expect(simulation.grants[0].postDataJSON()).toEqual({
      professional_email: 'profesional@example.com',
    });
    expect(await simulation.grants[0].headerValue('authorization')).toMatch(/^Bearer \S+$/);

    const entry = page.locator('[data-professional="profesional@example.com"]');
    await entry.getByRole('button', { name: 'Revocar', exact: true }).click();
    await expect(entry).toContainText('¿Revocar la autorización de profesional@example.com?');
    await entry.getByRole('button', { name: 'Revocar autorización' }).click();

    await expect(entry).toContainText('Autorización revocada');
    expect(simulation.revokes).toHaveLength(1);
    expect(new URL(simulation.revokes[0].url()).pathname).toBe(
      `/v1/me/training-authorizations/${SIMULATED_PROFESSIONAL_ID}`,
    );
  });

  test('el deportista recibe un aviso si el correo no es de un profesional', async ({ page }) => {
    const simulation = await loginAs(page, 'athlete');
    simulation.nextGrant = GRANT_AUTHORIZATION_RESPONSES.professionalNotFound;
    await page.goto('/deportista/entrenamientos/planes');

    await page.getByLabel('Correo del profesional').fill('otra-persona@example.com');
    await page.getByRole('button', { name: 'Autorizar', exact: true }).click();

    await expect(page.locator('mat-error')).toHaveText(
      'Este correo no corresponde a un profesional de servicios registrado.',
    );
    await expect(page.getByTestId('authorizations-empty')).toBeVisible();
  });
});
