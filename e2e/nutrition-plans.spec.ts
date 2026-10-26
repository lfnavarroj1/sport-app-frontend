import { Browser, Locator, Page, expect, test } from '@playwright/test';

import { GET_CAPABILITIES_RESPONSES } from '../src/testing/bff-web/capabilities.fixtures';
import {
  CREATE_NUTRITION_PLAN_RESPONSES,
  GET_NUTRITION_PLAN_RESPONSES,
} from '../src/testing/bff-web/nutrition.fixtures';
import {
  NutritionPlansStore,
  NutritionSimulation,
  simulateNutrition,
} from './support/nutrition-simulator';
import { SessionSimulation, login, sessionFor, simulateSession } from './support/session-simulator';

/**
 * HU014 Crear plan de alimentación: el profesional crea un plan por comidas con
 * alimentos del catálogo, ve los bloqueos por alergia o restricción junto al ítem
 * y el deportista consulta sus planes en «Mi alimentación» (ADR-037). El BFF está
 * reemplazado por el simulador del contrato bff-web 0.18.0. NO es E2E integrado.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function loginAs(
  page: Page,
  actorType: string,
  store: NutritionPlansStore = { plans: [] },
  configure: (session: SessionSimulation) => void = () => undefined,
): Promise<NutritionSimulation> {
  const session = await simulateSession(page, sessionFor(actorType));
  configure(session);
  const simulation = await simulateNutrition(page, store);
  await login(page);
  // El ingreso termina al llegar al inicio del actor: navegar antes perdería la sesión.
  await expect(page).toHaveURL(/\/(deportista|profesional|organizador)\/inicio$/);
  return simulation;
}

/** Cada actor usa su propio contexto: su sesión simulada no se mezcla. */
async function newPage(browser: Browser): Promise<Page> {
  return (await browser.newContext()).newPage();
}

async function openEditor(page: Page): Promise<void> {
  await page.locator('mat-sidenav [data-menu-item="nutrition-plans"]').click();
  await expect(page).toHaveURL(/\/profesional\/alimentacion\/planes$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Crear plan de alimentación');
}

async function chooseOption(page: Page, field: Locator, name: string): Promise<void> {
  await field.click();
  await page.getByRole('option', { name, exact: true }).click();
}

const item = (page: Page, meal: number, index: number) =>
  page.getByTestId(`nutrition-item-${meal}-${index}`);

async function fillPlan(page: Page): Promise<void> {
  await page.getByLabel('Correo del deportista').fill('deportista@example.com');
  await page.getByLabel('Título').fill('Recuperación tras la carrera');
  await page.getByRole('textbox', { name: 'Objetivo 1' }).fill('Mejorar la recuperación muscular');
  await page.getByLabel('Fecha de inicio').fill('2026-11-02');
  await page.getByLabel('Fecha de fin').fill('2026-11-29');
  await chooseOption(page, page.getByRole('combobox', { name: 'Tipo de comida' }), 'Desayuno');
  await chooseOption(page, item(page, 0, 0).getByRole('combobox', { name: 'Alimento' }), 'Avena');
  await item(page, 0, 0).getByLabel('Cantidad').fill('60');
  await page.getByRole('button', { name: 'Agregar alimento a la comida 1' }).click();
  await chooseOption(
    page,
    item(page, 0, 1).getByRole('combobox', { name: 'Alimento' }),
    'Mantequilla de maní',
  );
  await item(page, 0, 1).getByLabel('Cantidad').fill('1,5');
  await chooseOption(
    page,
    item(page, 0, 1).getByRole('combobox', { name: 'Unidad' }),
    'Cucharadas',
  );
}

async function reviewAndConfirm(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Revisar plan' }).click();
  await expect(page.getByRole('heading', { name: 'Confirma la asignación' })).toBeFocused();
  await page.getByRole('button', { name: 'Confirmar y asignar' }).click();
}

test.describe('HU014 Crear plan de alimentación (simulador del contrato) @simulado', () => {
  test('CA2 y CA1: el plan bloqueado por alergia se corrige, se asigna y el deportista lo ve', async ({
    page,
    browser,
  }) => {
    // Recorre dos actores (profesional y deportista) con dos ingresos: necesita más
    // que el límite por defecto cuando la suite corre en paralelo.
    test.setTimeout(60_000);
    const store: NutritionPlansStore = { plans: [] };
    const simulation = await loginAs(page, 'service_provider', store);
    simulation.nextCreate = {
      status: 422,
      body: {
        ...CREATE_NUTRITION_PLAN_RESPONSES.nutritionPlanInvalid.body,
        details: [{ field: 'body.meals.0.items.1.food_code', issue: 'conflicts_with_allergy' }],
      },
    };
    await openEditor(page);
    await fillPlan(page);
    await reviewAndConfirm(page);

    // CA2: el bloqueo vuelve al editor, junto al ítem, y nada se guarda.
    const errors = page.getByTestId('nutrition-errors');
    await expect(errors).toBeFocused();
    await expect(errors.getByRole('listitem')).toHaveText([
      'Comida 1, alimento 2: contiene un alérgeno que el deportista registró.',
    ]);
    await expect(item(page, 0, 1).locator('mat-error')).toContainText(
      'contiene un alérgeno que el deportista registró.',
    );
    await expect(item(page, 0, 0).locator('mat-error')).toHaveCount(0);
    await expect(page.getByTestId('nutrition-created')).toHaveCount(0);
    expect(store.plans).toHaveLength(0);

    // El profesional cambia el alimento bloqueado y confirma de nuevo con otra clave.
    await chooseOption(
      page,
      item(page, 0, 1).getByRole('combobox', { name: 'Alimento' }),
      'Banano',
    );
    await item(page, 0, 1).getByLabel('Cantidad').fill('1');
    await chooseOption(
      page,
      item(page, 0, 1).getByRole('combobox', { name: 'Unidad' }),
      'Unidades',
    );
    await expect(item(page, 0, 1).locator('mat-error')).toHaveCount(0);
    await reviewAndConfirm(page);

    const created = page.getByTestId('nutrition-created');
    await expect(created).toContainText('Plan asignado');
    await expect(created).toContainText(
      'El plan «Recuperación tras la carrera» quedó asignado a deportista@example.com.',
    );
    await expect(created).toContainText('Del 2 de noviembre de 2026 al 29 de noviembre de 2026');
    await expect(created.locator('tbody tr')).toHaveText([/Avena\s*60 g/, /Banano\s*1 und\./]);
    expect(simulation.creates).toHaveLength(2);
    const [blocked, accepted] = simulation.creates;
    expect(await accepted.headerValue('authorization')).toMatch(/^Bearer \S+$/);
    expect(await accepted.headerValue('idempotency-key')).toMatch(UUID);
    expect(await accepted.headerValue('idempotency-key')).not.toBe(
      await blocked.headerValue('idempotency-key'),
    );
    expect(accepted.postDataJSON()).toEqual({
      athlete_email: 'deportista@example.com',
      title: 'Recuperación tras la carrera',
      objectives: ['Mejorar la recuperación muscular'],
      start_date: '2026-11-02',
      end_date: '2026-11-29',
      meals: [
        {
          meal_type: 'BREAKFAST',
          items: [
            { food_code: 'OATS', quantity: '60', unit: 'G' },
            { food_code: 'BANANA', quantity: '1', unit: 'UNIT' },
          ],
        },
      ],
    });

    // CA4: la consulta del profesional muestra la versión 1 confirmada.
    await created.getByRole('link', { name: 'Consultar el plan' }).click();
    await expect(page).toHaveURL(/\/profesional\/alimentacion\/planes\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId('nutrition-detail-status')).toHaveText('Asignado');

    // CA5: el deportista ve el plan asignado en «Mi alimentación».
    const athlete = await newPage(browser);
    await loginAs(athlete, 'athlete', store);
    await athlete.locator('mat-sidenav [data-menu-item="athlete-nutrition"]').click();
    await expect(athlete).toHaveURL(/\/deportista\/alimentacion$/);
    await expect(athlete.getByRole('heading', { name: 'Planes de alimentación' })).toBeVisible();
    const plans = athlete.getByTestId('athlete-nutrition-list');
    await expect(plans.locator('mat-panel-title')).toHaveText(['Recuperación tras la carrera']);
    await expect(plans.getByTestId('athlete-nutrition-status')).toHaveText('Asignado');
    await expect(plans.locator('tbody tr')).toHaveText([/Avena\s*60 g/, /Banano\s*1 und\./]);
  });

  test('CA6: sin hábitos registrados el plan se crea con aviso; si Usuarios no responde no se crea', async ({
    page,
  }) => {
    const simulation = await loginAs(page, 'service_provider');
    simulation.nextCreate = CREATE_NUTRITION_PLAN_RESPONSES.upstreamUnavailable;
    simulation.warnings = ['nutrition_habits_missing'];
    await openEditor(page);
    await fillPlan(page);
    await reviewAndConfirm(page);

    const error = page.getByTestId('nutrition-error');
    await expect(error).toContainText('El servicio no está disponible');
    await expect(error).toContainText('El plan no se guardó.');
    await expect(error).toContainText('Código de referencia');

    // El reintento usa la misma clave y el plan se crea con el aviso del backend.
    await page.getByRole('button', { name: 'Confirmar y asignar' }).click();
    await expect(page.getByTestId('nutrition-created')).toBeVisible();
    await expect(page.getByTestId('nutrition-warning-habits')).toContainText(
      'sin poder validar alergias ni restricciones',
    );
    expect(simulation.creates).toHaveLength(2);
    expect(await simulation.creates[1].headerValue('idempotency-key')).toBe(
      await simulation.creates[0].headerValue('idempotency-key'),
    );
  });

  test('CA3: sin autorización del deportista no se asigna y se indica en el correo', async ({
    page,
  }) => {
    const simulation = await loginAs(page, 'service_provider');
    simulation.nextCreate = CREATE_NUTRITION_PLAN_RESPONSES.athleteAuthorizationRequired;
    await openEditor(page);
    await fillPlan(page);
    await reviewAndConfirm(page);

    await expect(page.getByRole('heading', { name: 'Datos del plan' })).toBeVisible();
    await expect(page.locator('mat-error').first()).toContainText(
      'no corresponde a un deportista que te haya autorizado',
    );
    await expect(page.getByTestId('nutrition-created')).toHaveCount(0);
  });

  test('CA3: sin nutrition.plan.author la opción no aparece y la ruta directa se rechaza', async ({
    page,
  }) => {
    await loginAs(page, 'service_provider', { plans: [] }, (session) => {
      session.capabilities = {
        status: 200,
        body: {
          ...GET_CAPABILITIES_RESPONSES.serviceProvider.body,
          permissions: ['services.create'],
        },
      };
    });
    await expect(page.locator('mat-sidenav [data-menu-item="nutrition-plans"]')).toHaveCount(0);

    await page.goto('/profesional/alimentacion/planes');

    await expect(page).toHaveURL(/\/acceso-no-autorizado$/);
  });

  test('CA3: un deportista no entra al editor y un tercero recibe 404 al consultar', async ({
    page,
    browser,
  }) => {
    await loginAs(page, 'athlete');
    await page.goto('/profesional/alimentacion/planes');
    await expect(page).toHaveURL(/\/acceso-no-autorizado$/);

    const outsider = await newPage(browser);
    const simulation = await loginAs(outsider, 'service_provider');
    simulation.nextRead = GET_NUTRITION_PLAN_RESPONSES.nutritionPlanNotFound;
    await outsider.goto(`/profesional/alimentacion/planes/${crypto.randomUUID()}`);
    await expect(outsider.getByTestId('nutrition-not-found')).toContainText(
      'no tienes acceso a él',
    );
    await expect(outsider.getByTestId('nutrition-summary')).toHaveCount(0);
  });

  test('el deportista pagina sus planes con el cursor del backend y ve el vacío sin error', async ({
    page,
    browser,
  }) => {
    const store: NutritionPlansStore = {
      plans: Array.from({ length: 3 }, (_, index) => ({
        ...GET_NUTRITION_PLAN_RESPONSES.found.body,
        plan_id: crypto.randomUUID(),
        title: `Plan sintético ${index + 1}`,
      })),
    };
    const simulation = await loginAs(page, 'athlete', store);
    simulation.pageSize = 2;
    await page.locator('mat-sidenav [data-menu-item="athlete-nutrition"]').click();

    const titles = page.getByTestId('athlete-nutrition-list').locator('mat-panel-title');
    await expect(titles).toHaveText(['Plan sintético 1', 'Plan sintético 2']);
    await page.getByRole('button', { name: 'Cargar más' }).click();
    await expect(titles).toHaveText(['Plan sintético 1', 'Plan sintético 2', 'Plan sintético 3']);
    await expect(page.getByRole('button', { name: 'Cargar más' })).toHaveCount(0);
    expect(new URL(simulation.listRequests[1].url()).searchParams.get('cursor')).toBe('p+2/=');

    const empty = await newPage(browser);
    await loginAs(empty, 'athlete');
    await empty.locator('mat-sidenav [data-menu-item="athlete-nutrition"]').click();
    await expect(empty.getByTestId('state-empty')).toContainText(
      'Aún no tienes planes de alimentación',
    );
  });
});
