import { Page, expect, test } from '@playwright/test';

import { GET_CAPABILITIES_RESPONSES } from '../src/testing/bff-web/capabilities.fixtures';
import {
  FOOD_INTAKES_RESPONSES,
  SIMULATED_INTAKES_ATHLETE_ID,
  foodIntakes,
} from '../src/testing/bff-web/food-intakes.fixtures';
import {
  TRAINING_ATHLETES_RESPONSES,
  trainingAthletes,
} from '../src/testing/bff-web/training-history.fixtures';
import { FoodIntakesSimulation, simulateFoodIntakes } from './support/food-intakes-simulator';
import { NutritionPlansStore, simulateNutrition } from './support/nutrition-simulator';
import { SessionSimulation, login, sessionFor, simulateSession } from './support/session-simulator';
import {
  TrainingHistorySimulation,
  simulateTrainingHistory,
} from './support/training-history-simulator';

/**
 * HU013 Ver historial de alimentación: el deportista consulta sus consumos (HU043)
 * en «Mi alimentación», junto a sus planes (HU014), y el profesional autorizado
 * los de un deportista que elige de su lista. El BFF está reemplazado por el
 * simulador del contrato bff-web 0.32.0. NO es E2E integrado.
 */

interface Simulations {
  readonly intakes: FoodIntakesSimulation;
  readonly athletes: TrainingHistorySimulation;
}

async function loginAs(
  page: Page,
  actorType: string,
  intakes: ReturnType<typeof foodIntakes> = [],
  configure: (session: SessionSimulation) => void = () => undefined,
  plans: NutritionPlansStore = { plans: [] },
): Promise<Simulations> {
  const session = await simulateSession(page, sessionFor(actorType));
  configure(session);
  await simulateNutrition(page, plans);
  const athletes = await simulateTrainingHistory(page);
  const simulation = await simulateFoodIntakes(page, intakes);
  await login(page);
  // El ingreso termina al llegar al inicio del actor: navegar antes perdería la sesión.
  await expect(page).toHaveURL(/\/(deportista|profesional|organizador)\/inicio$/);
  return { intakes: simulation, athletes };
}

const entries = (page: Page) => page.getByTestId('food-intakes-list').locator('[data-intake]');

test.describe('HU013 Ver historial de alimentación (simulador del contrato) @simulado', () => {
  test('CA5: sin consumos ni planes, «Mi alimentación» lo indica de forma explícita', async ({
    page,
  }) => {
    const { intakes } = await loginAs(page, 'athlete');

    await page.locator('mat-sidenav [data-menu-item="athlete-nutrition"]').click();

    await expect(page).toHaveURL(/\/deportista\/alimentacion$/);
    await expect(page.getByRole('heading', { name: 'Mis consumos' })).toBeVisible();
    await expect(page.getByTestId('athlete-nutrition-nothing-yet')).toContainText(
      'Aún no tienes consumos registrados ni planes de alimentación',
    );
    await expect(page.getByTestId('food-intakes').getByTestId('state-empty')).toHaveText(
      'Aún no tienes consumos registrados. Regístralos desde la app móvil.',
    );
    const request = intakes.requests[0];
    expect(new URL(request.url()).pathname).toBe('/v1/me/food-intakes');
    expect(await request.headerValue('authorization')).toMatch(/^Bearer \S+$/);
  });

  test('CA1 y CA4: pagina 25 consumos por cursor, sin perder ni repetir, con nombres y unidades', async ({
    page,
  }) => {
    const all = foodIntakes(25);
    const { intakes } = await loginAs(page, 'athlete', all);
    await page.goto('/deportista/alimentacion');

    await expect(entries(page)).toHaveCount(20);
    await expect(page.getByTestId('food-intakes-count')).toHaveText(
      'Consumos mostrados: 20. Hay más disponibles.',
    );
    const list = page.getByTestId('food-intakes-list');
    await expect(
      list.locator('[data-day]').first().getByRole('heading', { level: 4 }).first(),
    ).toHaveText('Cena');
    await expect(list).toContainText('Pechuga de pollo');
    await expect(list).toContainText('1,5 cda.');
    await expect(page.locator('main')).not.toContainText(/calor|kcal/i);

    await page.getByRole('button', { name: 'Cargar más consumos' }).click();
    await expect(entries(page)).toHaveCount(25);
    await expect(page.getByRole('button', { name: 'Cargar más consumos' })).toHaveCount(0);
    await expect(entries(page).nth(20)).toBeFocused();
    const shown = await entries(page).evaluateAll((items) =>
      items.map((item) => item.getAttribute('data-intake')),
    );
    expect(shown).toEqual(all.map((item) => item.intake_id));
    const second = new URL(intakes.requests[1].url()).searchParams;
    expect(second.get('cursor')).toBeTruthy();
    expect([...second.keys()].sort()).toEqual(['cursor', 'limit']);
  });

  test('CA1: filtra por periodo (días UTC) y tipo de comida', async ({ page }) => {
    const { intakes } = await loginAs(page, 'athlete', foodIntakes(12));
    await page.goto('/deportista/alimentacion');
    await expect(entries(page)).toHaveCount(12);

    await page.getByLabel('Desde').fill('2026-10-23');
    await page.getByLabel('Hasta').fill('2026-10-24');
    await page.getByRole('combobox', { name: 'Tipo de comida' }).click();
    await page.getByRole('option', { name: 'Desayuno', exact: true }).click();
    await page.getByRole('button', { name: 'Aplicar filtros' }).click();

    await expect(entries(page)).toHaveCount(2);
    const query = new URL(intakes.requests.at(-1)!.url()).searchParams;
    expect(query.get('from')).toBe('2026-10-23');
    expect(query.get('to')).toBe('2026-10-24');
    expect(query.get('meal_type')).toBe('BREAKFAST');

    await page.getByRole('combobox', { name: 'Tipo de comida' }).click();
    await page.getByRole('option', { name: 'Refrigerio', exact: true }).click();
    await page.getByRole('button', { name: 'Aplicar filtros' }).click();
    await expect(page.getByTestId('food-intakes').getByTestId('state-empty')).toHaveText(
      'No hay consumos con estos filtros.',
    );

    await page.getByRole('button', { name: 'Limpiar filtros' }).click();
    await expect(entries(page)).toHaveCount(12);
  });

  test('CA2: un periodo inválido se marca junto a «Hasta» y un cursor corrupto se explica', async ({
    page,
  }) => {
    const { intakes } = await loginAs(page, 'athlete', foodIntakes(25));
    await page.goto('/deportista/alimentacion');
    await expect(entries(page)).toHaveCount(20);
    const before = intakes.requests.length;

    await page.getByLabel('Desde').fill('2026-10-24');
    await page.getByLabel('Hasta').fill('2026-10-01');
    await page.getByRole('button', { name: 'Aplicar filtros' }).click();
    await expect(page.getByTestId('food-intakes-period-error')).toHaveText(
      'La fecha «Hasta» no puede ser anterior a la fecha «Desde».',
    );
    await expect(page.getByLabel('Hasta')).toHaveAttribute('aria-invalid', 'true');
    expect(intakes.requests.length).toBe(before);
    await page.getByRole('button', { name: 'Limpiar filtros' }).click();
    await expect(entries(page)).toHaveCount(20);

    intakes.next = FOOD_INTAKES_RESPONSES.invalidCursor;
    await page.getByRole('button', { name: 'Cargar más consumos' }).click();
    await expect(page.getByTestId('food-intakes-more-error')).toContainText(
      'No se pudo continuar la lista',
    );
    await expect(entries(page)).toHaveCount(20);
    await page.getByRole('button', { name: 'Volver a cargar desde el inicio' }).click();
    await expect(page.getByTestId('food-intakes-more-error')).toHaveCount(0);
    await expect(entries(page)).toHaveCount(20);
  });

  test('un error del servicio no se muestra como historial vacío y permite reintentar', async ({
    page,
  }) => {
    const { intakes } = await loginAs(page, 'athlete', foodIntakes(3));
    intakes.next = FOOD_INTAKES_RESPONSES.upstreamUnavailable;
    await page.goto('/deportista/alimentacion');

    const section = page.getByTestId('food-intakes');
    await expect(section.getByTestId('state-error')).toContainText('Código de referencia');
    await expect(section.getByTestId('state-empty')).toHaveCount(0);
    await expect(page.getByTestId('athlete-nutrition-nothing-yet')).toHaveCount(0);

    await section.getByRole('button', { name: 'Reintentar' }).click();
    await expect(entries(page)).toHaveCount(3);
  });

  test('el profesional elige un deportista autorizado y ve solo sus consumos', async ({ page }) => {
    const { intakes, athletes } = await loginAs(page, 'service_provider', foodIntakes(3));
    athletes.athletes = trainingAthletes(2).map((athlete, index) =>
      index === 0 ? { ...athlete, athlete_id: SIMULATED_INTAKES_ATHLETE_ID } : athlete,
    );
    intakes.authorizedAthletes.add(SIMULATED_INTAKES_ATHLETE_ID);

    await page.locator('mat-sidenav [data-menu-item="nutrition-history"]').click();
    await expect(page).toHaveURL(/\/profesional\/historial\/alimentacion$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Historial de alimentación');
    const items = page.getByTestId('nutrition-athletes-list').getByRole('listitem');
    await expect(items).toHaveCount(2);
    await expect(items.first()).toContainText('deportista-1@example.com');

    await items.first().getByRole('link').click();
    await expect(page).toHaveURL(
      new RegExp(`/profesional/historial/alimentacion/${SIMULATED_INTAKES_ATHLETE_ID}$`),
    );
    await expect(page.getByRole('heading', { name: 'Consumos del deportista' })).toBeVisible();
    await expect(entries(page)).toHaveCount(3);
    await expect(page.getByTestId('food-intakes-list')).toContainText('Agua');
    expect(new URL(intakes.requests[0].url()).pathname).toBe(
      `/v1/athletes/${SIMULATED_INTAKES_ATHLETE_ID}/food-intakes`,
    );
  });

  test('CA3: sin autorización vigente el profesional recibe el rechazo sin datos', async ({
    page,
  }) => {
    await loginAs(page, 'service_provider', foodIntakes(3));

    await page.goto(`/profesional/historial/alimentacion/${crypto.randomUUID()}`);

    await expect(page.getByTestId('food-intakes-not-authorized')).toContainText(
      'No tienes una autorización vigente de este deportista',
    );
    await expect(page.getByTestId('food-intakes-list')).toHaveCount(0);
  });

  test('la lista de deportistas rechazada por permiso se explica sin mostrarla vacía', async ({
    page,
  }) => {
    const { athletes } = await loginAs(page, 'service_provider');
    athletes.nextAthletes = TRAINING_ATHLETES_RESPONSES.permissionRequired;
    await page.goto('/profesional/historial/alimentacion');

    await expect(page.getByTestId('nutrition-athletes-permission-denied')).toBeVisible();
    await expect(page.getByTestId('state-empty')).toHaveCount(0);
  });

  test('sin el permiso nutrition.history.view_assigned la opción no aparece ni la ruta abre', async ({
    page,
  }) => {
    const { body } = GET_CAPABILITIES_RESPONSES.serviceProvider;
    await loginAs(page, 'service_provider', [], (session) => {
      session.capabilities = {
        status: 200,
        body: {
          ...body,
          permissions: body.permissions.filter(
            (permission) => permission !== 'nutrition.history.view_assigned',
          ),
        },
      };
    });

    await expect(page.locator('mat-sidenav [data-menu-item="nutrition-history"]')).toHaveCount(0);
    await page.goto('/profesional/historial/alimentacion');
    await expect(page).toHaveURL(/\/acceso-no-autorizado$/);
  });

  test('el deportista no entra al historial de alimentación del profesional', async ({ page }) => {
    await loginAs(page, 'athlete');

    await page.goto(`/profesional/historial/alimentacion/${SIMULATED_INTAKES_ATHLETE_ID}`);

    await expect(page).toHaveURL(/\/acceso-no-autorizado$/);
  });
});
