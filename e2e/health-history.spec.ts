import { Page, expect, test } from '@playwright/test';

import {
  HEALTH_REPORTS_RESPONSES,
  SIMULATED_HEALTH_ATHLETE_ID,
  healthReports,
} from '../src/testing/bff-web/health-reports.fixtures';
import { trainingAthletes } from '../src/testing/bff-web/training-history.fixtures';
import { HealthReportsSimulation, simulateHealthReports } from './support/health-reports-simulator';
import { login, sessionFor, simulateSession } from './support/session-simulator';
import {
  TrainingHistorySimulation,
  simulateTrainingHistory,
} from './support/training-history-simulator';

/**
 * HU012 Ver historial de molestias, incapacidades o lesiones (ADR-037): el
 * deportista consulta el suyo en «Mi salud» y el profesional el de un deportista
 * que lo autorizó, al que elige de su lista (`GET /v1/me/training-athletes`). El
 * BFF está reemplazado por el simulador del contrato bff-web 0.33.0. NO es E2E
 * integrado. Datos sintéticos.
 */

interface Simulations {
  readonly health: HealthReportsSimulation;
  readonly athletes: TrainingHistorySimulation;
}

async function loginAs(
  page: Page,
  actorType: string,
  reports: ReturnType<typeof healthReports> = [],
): Promise<Simulations> {
  await simulateSession(page, sessionFor(actorType));
  const athletes = await simulateTrainingHistory(page);
  const health = await simulateHealthReports(page, reports);
  await login(page);
  // El ingreso termina al llegar al inicio del actor: navegar antes perdería la sesión.
  await expect(page).toHaveURL(/\/(deportista|profesional|organizador)\/inicio$/);
  return { health, athletes };
}

const rows = (page: Page) => page.getByTestId('health-table').locator('tbody tr');

test.describe('HU012 Ver historial de molestias o lesiones (simulador del contrato) @simulado', () => {
  test('CA4: el deportista sin reportes ve el vacío explícito y el aviso desde «Mi salud»', async ({
    page,
  }) => {
    const { health } = await loginAs(page, 'athlete');

    await page.locator('mat-sidenav [data-menu-item="athlete-health"]').click();

    await expect(page).toHaveURL(/\/deportista\/salud$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Mi salud');
    await expect(page.getByRole('note')).toContainText('Información de salud sensible');
    await expect(page.getByRole('note')).toContainText('no constituyen un diagnóstico médico');
    await expect(page.getByTestId('state-empty')).toHaveText(
      'Aún no tienes reportes de molestias, incapacidades o lesiones.',
    );
    const request = health.requests[0];
    expect(new URL(request.url()).pathname).toBe('/v1/me/health-reports');
    expect(await request.headerValue('authorization')).toMatch(/^Bearer \S+$/);
  });

  test('CA1 y CA6: pagina 25 reportes sin perder ni repetir, en el orden del backend', async ({
    page,
  }) => {
    const reports = healthReports(25);
    const { health } = await loginAs(page, 'athlete', reports);
    await page.goto('/deportista/salud');

    await expect(rows(page)).toHaveCount(20);
    await expect(rows(page).first()).toContainText('Molestia');
    await expect(rows(page).first()).toContainText('Rodilla');
    await expect(rows(page).first()).toContainText('Baja');
    await expect(page.getByTestId('health-count')).toHaveText(
      'Reportes mostrados: 20. Hay más disponibles.',
    );
    await page.getByRole('button', { name: 'Cargar más' }).click();

    await expect(rows(page)).toHaveCount(25);
    await expect(page.getByRole('button', { name: 'Cargar más' })).toHaveCount(0);
    const shown = await rows(page).evaluateAll((items) =>
      items.map((item) => item.getAttribute('data-report')),
    );
    expect(shown).toEqual(reports.map((item) => item.report_id));
    expect(new URL(health.requests[1].url()).searchParams.get('cursor')).toBeTruthy();
  });

  test('CA1: filtra por tipo, severidad y periodo', async ({ page }) => {
    const { health } = await loginAs(page, 'athlete', healthReports(9));
    await page.goto('/deportista/salud');
    await expect(rows(page)).toHaveCount(9);

    await page.getByLabel('Tipo').click();
    await page.getByRole('option', { name: 'Incapacidad' }).click();
    await page.getByLabel('Severidad').click();
    await page.getByRole('option', { name: 'Alta' }).click();
    await page.getByLabel('Ocurridos desde').fill('2026-10-12');
    await page.getByRole('button', { name: 'Aplicar filtros' }).click();

    await expect(rows(page)).toHaveCount(2);
    for (const row of await rows(page).all()) {
      await expect(row).toContainText('Incapacidad');
      await expect(row).toContainText('Alta');
    }
    const query = new URL(health.requests.at(-1)!.url()).searchParams;
    expect(query.get('type')).toBe('INCAPACITY');
    expect(query.get('severity')).toBe('HIGH');
    expect(query.get('from')).toBe('2026-10-12');
    expect(query.has('to')).toBe(false);
  });

  test('CA6: un periodo inválido (422) se explica junto a los filtros, sin datos', async ({
    page,
  }) => {
    await loginAs(page, 'athlete', healthReports(3));
    await page.goto('/deportista/salud');
    await expect(rows(page)).toHaveCount(3);

    await page.getByLabel('Ocurridos desde').fill('2026-10-20');
    await page.getByLabel('Ocurridos hasta').fill('2026-10-01');
    await page.getByRole('button', { name: 'Aplicar filtros' }).click();

    await expect(page.getByTestId('health-own-error')).toContainText(
      'El periodo o los filtros no son válidos',
    );
    await expect(page.getByTestId('health-table')).toHaveCount(0);
  });

  test('un fallo del servicio se informa con referencia y permite reintentar', async ({
    page,
  }) => {
    const { health } = await loginAs(page, 'athlete', healthReports(2));
    health.next = HEALTH_REPORTS_RESPONSES.upstreamUnavailable;
    await page.goto('/deportista/salud');

    const error = page.getByTestId('state-error');
    await expect(error).toContainText('Código de referencia');
    await error.getByRole('button').click();
    await expect(rows(page)).toHaveCount(2);
  });

  test('CA2: el profesional elige por nombre y correo a un deportista que lo autorizó y ve sus reportes', async ({
    page,
  }) => {
    const { health, athletes } = await loginAs(page, 'service_provider', healthReports(3));
    athletes.athletes = trainingAthletes(2);
    health.authorizedAthletes.add(SIMULATED_HEALTH_ATHLETE_ID);

    await page.locator('mat-sidenav [data-menu-item="health-history"]').click();
    await expect(page).toHaveURL(/\/profesional\/historial\/salud$/);
    const items = page.getByTestId('health-athletes-list').getByRole('listitem');
    await expect(items).toHaveCount(2);
    await expect(items.first()).toContainText('Deportista Sintético 1');
    await expect(items.first()).toContainText('deportista-1@example.com');

    await items.first().getByRole('link').click();

    await expect(page).toHaveURL(
      new RegExp(`/profesional/historial/salud/${SIMULATED_HEALTH_ATHLETE_ID}$`),
    );
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Historial de salud del deportista',
    );
    await expect(page.getByRole('note')).toContainText(
      'mientras el deportista mantenga tu autorización',
    );
    await expect(rows(page)).toHaveCount(3);
    expect(new URL(health.requests[0].url()).pathname).toBe(
      `/v1/athletes/${SIMULATED_HEALTH_ATHLETE_ID}/health-reports`,
    );

    await page.getByRole('link', { name: 'Elegir otro deportista' }).click();
    await expect(page).toHaveURL(/\/profesional\/historial\/salud$/);
  });

  test('CA3: sin autorización vigente el profesional recibe el rechazo sin datos', async ({
    page,
  }) => {
    await loginAs(page, 'service_provider', healthReports(2));

    await page.goto(`/profesional/historial/salud/${SIMULATED_HEALTH_ATHLETE_ID}`);

    await expect(page.getByTestId('health-own-error')).toContainText(
      'no te ha autorizado o revocó la autorización',
    );
    await expect(page.getByTestId('health-table')).toHaveCount(0);
  });

  test('CA3: el deportista no entra al historial de salud de otro deportista', async ({ page }) => {
    await loginAs(page, 'athlete');

    await page.goto(`/profesional/historial/salud/${SIMULATED_HEALTH_ATHLETE_ID}`);

    await expect(page).toHaveURL(/\/acceso-no-autorizado$/);
  });

  test('el organizador no tiene opciones de historial de salud', async ({ page }) => {
    await loginAs(page, 'organizer');

    await expect(page.locator('[data-menu-item="health-history"]')).toHaveCount(0);
    await expect(page.locator('[data-menu-item="athlete-health"]')).toHaveCount(0);
  });
});
