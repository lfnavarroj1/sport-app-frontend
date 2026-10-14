import { Page, expect, test } from '@playwright/test';

import {
  TRAINING_HISTORY_RESPONSES,
  historyItems,
} from '../src/testing/bff-web/training-history.fixtures';
import { SIMULATED_ATHLETE_ID } from '../src/testing/bff-web/training.fixtures';
import { login, sessionFor, simulateSession } from './support/session-simulator';
import {
  TrainingHistorySimulation,
  simulateTrainingHistory,
} from './support/training-history-simulator';
import { simulateTraining } from './support/training-simulator';

/**
 * HU011 Ver historial de entrenamiento: el deportista consulta el suyo y el
 * profesional el de un deportista que lo autorizó, al que llega desde el plan
 * (HU010). El BFF está reemplazado por el simulador del contrato bff-web 0.12.0.
 * NO es E2E integrado.
 */

async function loginAs(
  page: Page,
  actorType: string,
  sessions: ReturnType<typeof historyItems> = [],
): Promise<TrainingHistorySimulation> {
  await simulateSession(page, sessionFor(actorType));
  await simulateTraining(page);
  const simulation = await simulateTrainingHistory(page, sessions);
  await login(page);
  // El ingreso termina al llegar al inicio del actor: navegar antes perdería la sesión.
  await expect(page).toHaveURL(/\/(deportista|profesional|organizador)\/inicio$/);
  return simulation;
}

const rows = (page: Page) => page.getByTestId('history-table').locator('tbody tr');

test.describe('HU011 Ver historial de entrenamiento (simulador del contrato) @simulado', () => {
  test('CA2: el deportista sin historial ve el estado vacío desde su menú', async ({ page }) => {
    const simulation = await loginAs(page, 'athlete');

    await page.locator('mat-sidenav [data-menu-item="athlete-training-history"]').click();

    await expect(page).toHaveURL(/\/deportista\/historial\/entrenamientos$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Mi historial de entrenamiento',
    );
    await expect(page.getByTestId('state-empty')).toHaveText(
      'Aún no tienes entrenamientos terminados.',
    );
    await expect(page.getByRole('button', { name: 'Aplicar filtros' })).toBeVisible();
    const request = simulation.requests[0];
    expect(new URL(request.url()).pathname).toBe('/v1/training-history');
    expect(await request.headerValue('authorization')).toMatch(/^Bearer \S+$/);
  });

  test('CA1 y CA4: pagina 25 sesiones sin perder ni repetir y muestra el detalle', async ({
    page,
  }) => {
    const sessions = historyItems(25);
    const simulation = await loginAs(page, 'athlete', sessions);
    await page.goto('/deportista/historial/entrenamientos');

    await expect(rows(page)).toHaveCount(20);
    await expect(page.getByTestId('history-count')).toHaveText(
      'Sesiones mostradas: 20. Hay más disponibles.',
    );
    await page.getByRole('button', { name: 'Cargar más' }).click();

    await expect(rows(page)).toHaveCount(25);
    await expect(page.getByRole('button', { name: 'Cargar más' })).toHaveCount(0);
    const shown = await rows(page).evaluateAll((items) =>
      items.map((item) => item.getAttribute('data-session')),
    );
    expect(shown).toEqual(sessions.map((item) => item.session_id));
    expect(new URL(simulation.requests[1].url()).searchParams.get('cursor')).toBeTruthy();

    await rows(page).first().getByRole('button', { name: 'Ver detalle' }).click();
    const detail = page.getByTestId('history-detail');
    await expect(detail).toContainText('Detalle de la sesión');
    await expect(detail).toContainText('Parte de un plan');
  });

  test('CA1: filtra por deporte y periodo', async ({ page }) => {
    const simulation = await loginAs(page, 'athlete', historyItems(9));
    await page.goto('/deportista/historial/entrenamientos');
    await expect(rows(page)).toHaveCount(9);

    await page.getByLabel('Deporte').click();
    await page.getByRole('option', { name: 'Natación' }).click();
    await page.getByLabel('Terminadas desde').fill('2026-10-01');
    await page.getByRole('button', { name: 'Aplicar filtros' }).click();

    await expect(rows(page)).toHaveCount(3);
    for (const row of await rows(page).all()) {
      await expect(row).toContainText('Natación');
    }
    const query = new URL(simulation.requests.at(-1)!.url()).searchParams;
    expect(query.get('sport')).toBe('swimming');
    expect(query.get('from')).toBe('2026-10-01');
    expect(query.has('to')).toBe(false);
  });

  test('el profesional llega al historial del deportista desde el plan asignado', async ({
    page,
  }) => {
    const simulation = await loginAs(page, 'service_provider', historyItems(2));
    await page.locator('mat-sidenav [data-menu-item="training-history"]').click();
    await expect(page.getByTestId('history-professional-intro')).toContainText(
      'Ver historial de entrenamiento',
    );

    await page.getByRole('link', { name: 'Ir a planes de entrenamiento' }).click();
    await page.getByLabel('Correo del deportista').fill('deportista@example.com');
    await page.getByLabel('Título').fill('Base aeróbica');
    await page.getByRole('textbox', { name: 'Objetivo 1' }).fill('Mejorar la resistencia');
    await page.getByLabel('Fecha de inicio').fill('2026-11-02');
    await page.getByLabel('Fecha de fin').fill('2026-12-27');
    await page.getByLabel('Fecha', { exact: true }).fill('2026-11-03');
    await page.getByLabel('Deporte').click();
    await page.getByRole('option', { name: 'Carrera' }).click();
    await page.getByLabel('Duración (min)').fill('45');
    await page.getByLabel('Intensidad (RPE)').fill('4');
    await page.getByRole('button', { name: 'Revisar plan' }).click();
    await page.getByRole('button', { name: 'Confirmar y asignar' }).click();

    await page.getByRole('link', { name: 'Ver historial de entrenamiento' }).click();

    await expect(page).toHaveURL(
      new RegExp(`/profesional/historial/entrenamientos/${SIMULATED_ATHLETE_ID}$`),
    );
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Historial de entrenamiento del deportista',
    );
    await expect(rows(page)).toHaveCount(2);
    expect(new URL(simulation.requests[0].url()).pathname).toBe(
      `/v1/athletes/${SIMULATED_ATHLETE_ID}/training-history`,
    );
  });

  test('CA3: sin relación vigente el profesional recibe el rechazo sin datos', async ({ page }) => {
    const simulation = await loginAs(page, 'service_provider', historyItems(2));
    simulation.next = TRAINING_HISTORY_RESPONSES.athleteAuthorizationRequired;

    await page.goto(`/profesional/historial/entrenamientos/${SIMULATED_ATHLETE_ID}`);

    await expect(page.getByTestId('history-not-authorized')).toContainText(
      'no te ha autorizado o revocó la autorización',
    );
    await expect(page.getByTestId('history-table')).toHaveCount(0);
  });

  test('el deportista no entra al historial de otro deportista', async ({ page }) => {
    await loginAs(page, 'athlete');
    await expect(page).toHaveURL(/\/deportista\/inicio$/);

    await page.goto(`/profesional/historial/entrenamientos/${SIMULATED_ATHLETE_ID}`);

    await expect(page).toHaveURL(/\/acceso-no-autorizado$/);
  });
});
