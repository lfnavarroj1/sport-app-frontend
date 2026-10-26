import { Locator, Page, expect, test } from '@playwright/test';

import { GET_CAPABILITIES_RESPONSES } from '../src/testing/bff-web/capabilities.fixtures';
import {
  MY_ROUTINES_RESPONSES,
  PUBLISH_ROUTINE_RESPONSES,
  SIMULATED_ROUTINES_CORRELATION_ID,
  VALID_PUBLISH_ROUTINE_REQUEST,
  professionalRoutine,
  professionalRoutines,
} from '../src/testing/bff-web/nutrition-routines.fixtures';
import { FOOD_CATALOG_RESPONSES } from '../src/testing/bff-web/nutrition.fixtures';
import { NutritionSimulation, simulateNutrition } from './support/nutrition-simulator';
import {
  NutritionRoutinesSimulation,
  simulateNutritionRoutines,
} from './support/nutrition-routines-simulator';
import { SessionSimulation, login, sessionFor, simulateSession } from './support/session-simulator';

/**
 * HU030 Sugerir rutinas alimenticias (web del profesional): publica rutinas de
 * alimentación con alimentos del catálogo de HU014 y retira las propias en
 * `/profesional/alimentacion/plantillas` (ADR-041). El BFF está reemplazado por
 * los simuladores del contrato bff-web 0.34.0. NO es E2E integrado.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PAGE_URL = /\/profesional\/alimentacion\/plantillas$/;
const REFERENCE = `Código de referencia: ${SIMULATED_ROUTINES_CORRELATION_ID}`;
const TITLE = VALID_PUBLISH_ROUTINE_REQUEST.title;

interface Simulations {
  readonly routines: NutritionRoutinesSimulation;
  readonly catalog: NutritionSimulation;
}

async function loginAs(
  page: Page,
  actorType = 'service_provider',
  routines = [professionalRoutine(1), professionalRoutine(2)],
  configure: (session: SessionSimulation) => void = () => undefined,
): Promise<Simulations> {
  const session = await simulateSession(page, sessionFor(actorType));
  configure(session);
  const catalog = await simulateNutrition(page);
  const simulation = await simulateNutritionRoutines(page, routines);
  await login(page);
  // El ingreso termina al llegar al inicio del actor: navegar antes perdería la sesión.
  await expect(page).toHaveURL(/\/(deportista|profesional|organizador)\/inicio$/);
  return { routines: simulation, catalog };
}

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const form = (page: Page) => page.getByTestId('routine-form');
const items = (page: Page) => page.getByTestId('routines-list').locator('li[data-routine]');
const meal = (page: Page, index: number) => form(page).locator(`[data-meal="${index}"]`);
const menuItem = (page: Page) => page.locator('mat-sidenav [data-menu-item="nutrition-routines"]');

async function openRoutines(page: Page): Promise<void> {
  await menuItem(page).click();
  await expect(page).toHaveURL(PAGE_URL);
}

async function choose(scope: Locator, label: string, option: string): Promise<void> {
  // Se pulsa el campo completo: la etiqueta de un `mat-select` vacío cubre el disparador.
  await scope
    .locator('mat-form-field', { has: scope.page().getByLabel(label, { exact: true }) })
    .click();
  await scope.page().getByRole('option', { name: option, exact: true }).click();
}

async function fillItem(page: Page, m: number, i: number, food: string, portions: number) {
  const target = meal(page, m).locator(`[data-item="${i}"]`);
  await choose(target, `Alimento ${i + 1}`, food);
  await target.getByLabel(`Porciones del alimento ${i + 1}`).fill(String(portions));
}

/**
 * Llena la rutina válida de los fixtures (desayuno con avena y mantequilla de
 * maní e hidratación con agua) declarando la leche; el título lleva espacios de sobra.
 */
async function fillRoutine(page: Page): Promise<void> {
  const request = VALID_PUBLISH_ROUTINE_REQUEST;
  await form(page).getByLabel('Título', { exact: true }).fill(`  ${request.title}  `);
  await form(page).getByLabel('Descripción', { exact: true }).fill(request.description);
  await choose(form(page), 'Objetivo', 'Rendimiento');
  await choose(form(page), 'Deporte', 'Carrera');
  await choose(form(page), 'Patrón alimentario', 'Vegetariano');
  await form(page)
    .getByLabel('Vigencia (días)', { exact: true })
    .fill(String(request.duration_days));
  await page.getByTestId('routine-allergens').getByText('Leche', { exact: true }).click();
  await choose(meal(page, 0), 'Tipo de comida', 'Desayuno');
  await fillItem(page, 0, 0, 'Avena', 2);
  await page.getByTestId('routine-add-item-0').click();
  await fillItem(page, 0, 1, 'Mantequilla de maní', 1);
  await page.getByTestId('routine-add-meal').click();
  await choose(meal(page, 1), 'Tipo de comida', 'Hidratación');
  await fillItem(page, 1, 0, 'Agua', 4);
}

test.describe('HU030 Rutinas de alimentación del profesional (simulador del contrato) @simulado', () => {
  test('CA2 y CA4: publica una rutina con alérgenos y comidas del catálogo y la ve primera', async ({
    page,
  }) => {
    const { routines: simulation, catalog } = await loginAs(page);
    await openRoutines(page);
    await expect(items(page)).toHaveCount(2);

    await button(page, 'Publicar una rutina').click();
    await expect(page.getByTestId('routine-disclaimer')).toContainText(
      'no reemplaza una valoración médica',
    );
    await fillRoutine(page);
    await button(page, 'Publicar rutina').click();

    await expect(page.getByTestId('routine-published')).toHaveText(
      new RegExp(`Publicamos la rutina «${TITLE}»`),
    );
    await expect(page.getByTestId('routine-published')).toBeFocused();
    await expect(page.getByTestId('routine-published-replayed')).toHaveCount(0);
    await expect(form(page)).toHaveCount(0);
    await expect(items(page)).toHaveCount(3);
    const first = items(page).first();
    await expect(first).toContainText(TITLE);
    await expect(first.getByTestId('routine-status')).toHaveText('Publicada');
    await expect(first.getByTestId('routine-days')).toHaveText('14 días');
    // CA2: los declarados más el maní que aporta la mantequilla, confirmados por el servicio.
    await expect(first.getByTestId('routine-allergens-list')).toHaveText('Maní, Leche');
    const meals = first.getByTestId('routine-meals-list');
    await expect(meals).toContainText('2 comidas · 3 alimentos');
    await expect(meals).toContainText('Desayuno: Avena ×2, Mantequilla de maní ×1');
    await expect(meals).toContainText('Hidratación: Agua ×4');

    expect(catalog.catalogRequests.length).toBeGreaterThan(0);
    expect(simulation.publishRequests).toHaveLength(1);
    const request = simulation.publishRequests[0];
    expect(await request.headerValue('idempotency-key')).toMatch(UUID);
    // Exactamente el cuerpo del contrato: sin `professional_id` y con el título recortado.
    expect(request.postDataJSON()).toEqual(VALID_PUBLISH_ROUTINE_REQUEST);

    // Al recargar, la rutina llega de la consulta.
    await page.reload();
    await expect(items(page).first()).toContainText(TITLE);
    await expect(items(page)).toHaveCount(3);
  });

  test('CA4: un alimento incompatible con el patrón se marca en su lugar; nada se publica', async ({
    page,
  }) => {
    const { routines: simulation } = await loginAs(page);
    await openRoutines(page);
    await button(page, 'Publicar una rutina').click();
    await fillRoutine(page);
    // La pechuga de pollo es incompatible con el patrón vegetariano del catálogo simulado.
    await fillItem(page, 1, 0, 'Pechuga de pollo', 1);
    await button(page, 'Publicar rutina').click();

    const errors = page.getByTestId('routine-errors');
    await expect(errors).toBeFocused();
    await expect(errors.getByRole('listitem')).toHaveText([
      'Comida 2, alimento 1: El alimento no es compatible con el patrón alimentario de la rutina.',
    ]);
    await expect(meal(page, 1).locator('[data-item="0"]')).toContainText(
      'no es compatible con el patrón',
    );
    await expect(page.getByTestId('routine-published')).toHaveCount(0);
    await expect(items(page)).toHaveCount(2);
    expect(simulation.routines).toHaveLength(2);
  });

  test('CA4: las reglas del 422 se marcan en su campo, alérgenos y alimentos', async ({ page }) => {
    const { routines: simulation } = await loginAs(page);
    await openRoutines(page);
    simulation.nextPublish.push(PUBLISH_ROUTINE_RESPONSES.validationError);
    await button(page, 'Publicar una rutina').click();
    await fillRoutine(page);
    await button(page, 'Publicar rutina').click();

    const errors = page.getByTestId('routine-errors');
    await expect(errors).toBeFocused();
    await expect(errors.getByRole('listitem')).toHaveText([
      'Título: La longitud no es válida.',
      'Alérgenos que contiene: Hay valores repetidos.',
      'Comida 1, alimento 2: El valor no existe en el catálogo.',
      'Comida 2, alimento 1: El alimento no es compatible con el patrón alimentario de la rutina.',
      'Comida 2, alimento 1 (porciones): El valor está fuera del rango permitido.',
    ]);
    await expect(page.getByTestId('routine-allergens-error')).toHaveText('Hay valores repetidos.');
    await expect(meal(page, 0).locator('[data-item="1"]')).toContainText(
      'El valor no existe en el catálogo.',
    );
  });

  test('el formulario no envía días ni porciones fuera de rango', async ({ page }) => {
    const { routines: simulation } = await loginAs(page);
    await openRoutines(page);
    await button(page, 'Publicar una rutina').click();
    await fillRoutine(page);
    await form(page).getByLabel('Vigencia (días)', { exact: true }).fill('91');
    await meal(page, 0).getByLabel('Porciones del alimento 1').fill('11');
    await button(page, 'Publicar rutina').click();

    await expect(form(page)).toContainText('El valor máximo permitido es 90.');
    await expect(meal(page, 0)).toContainText('El valor máximo permitido es 10.');
    expect(simulation.publishRequests).toHaveLength(0);
  });

  test('el día tipo admite de 1 a 8 comidas', async ({ page }) => {
    await loginAs(page);
    await openRoutines(page);
    await button(page, 'Publicar una rutina').click();

    await expect(form(page).locator('[data-meal]')).toHaveCount(1);
    await expect(button(page, 'Quitar la comida 1')).toBeDisabled();
    for (let n = 2; n <= 8; n++) {
      await page.getByTestId('routine-add-meal').click();
    }
    await expect(form(page).locator('[data-meal]')).toHaveCount(8);
    await expect(page.getByTestId('routine-add-meal')).toBeDisabled();

    await button(page, 'Quitar la comida 8').click();
    await expect(form(page).locator('[data-meal]')).toHaveCount(7);
    await expect(page.getByTestId('routine-add-meal')).toBeEnabled();
  });

  test('CA4: ante 503 reintenta con la misma clave y publica una sola rutina', async ({ page }) => {
    const { routines: simulation } = await loginAs(page);
    await openRoutines(page);
    simulation.nextPublish.push(PUBLISH_ROUTINE_RESPONSES.upstreamUnavailable);
    await button(page, 'Publicar una rutina').click();
    await fillRoutine(page);
    await button(page, 'Publicar rutina').click();

    await expect(page.getByTestId('routine-retrying')).toContainText('1 de 3');
    await expect(page.getByTestId('routine-published')).toBeVisible();
    expect(simulation.publishRequests).toHaveLength(2);
    const [first, second] = await Promise.all(
      simulation.publishRequests.map((request) => request.headerValue('idempotency-key')),
    );
    expect(second).toBe(first);
    expect(simulation.routines.filter((routine) => routine.title === TITLE)).toHaveLength(1);
  });

  test('CA4: si se perdió la respuesta, el reintento muestra la confirmación anterior sin duplicar', async ({
    page,
  }) => {
    const { routines: simulation } = await loginAs(page);
    await openRoutines(page);
    simulation.lostResponses = 1;
    await button(page, 'Publicar una rutina').click();
    await fillRoutine(page);
    await button(page, 'Publicar rutina').click();

    await expect(page.getByTestId('routine-published-replayed')).toHaveText(
      'Esta confirmación corresponde a un envío anterior: no se publicó otra rutina.',
    );
    expect(simulation.publishRequests).toHaveLength(2);
    await expect(items(page)).toHaveCount(3);
    expect(simulation.routines.filter((routine) => routine.title === TITLE)).toHaveLength(1);
  });

  test('un fallo del catálogo de alimentos se informa con reintento; no muestra un formulario vacío', async ({
    page,
  }) => {
    const { catalog } = await loginAs(page);
    catalog.nextCatalog = FOOD_CATALOG_RESPONSES.upstreamUnavailable;
    await openRoutines(page);
    await button(page, 'Publicar una rutina').click();

    const box = page.getByTestId('routine-catalog');
    await expect(box.getByTestId('state-error')).toBeVisible();
    await expect(form(page)).toHaveCount(0);
    await box.getByRole('button', { name: 'Reintentar' }).click();
    await expect(form(page)).toBeVisible();
  });

  test('sin rutinas muestra el estado vacío', async ({ page }) => {
    await loginAs(page, 'service_provider', []);
    await openRoutines(page);

    await expect(page.getByTestId('state-empty')).toHaveText('Aún no has publicado rutinas.');
    await expect(button(page, 'Publicar una rutina')).toBeVisible();
  });

  test('«Cargar más» pide la página siguiente con el cursor sin modificar', async ({ page }) => {
    const { routines: simulation } = await loginAs(page, 'service_provider', [
      ...professionalRoutines(20, 1),
      professionalRoutine(21, 'RETIRED'),
    ]);
    await openRoutines(page);
    await expect(items(page)).toHaveCount(20);
    const nextCursor = 'rutinas-desde-20';

    // Un fallo de la página siguiente no borra lo ya cargado.
    simulation.nextList.push(MY_ROUTINES_RESPONSES.upstreamUnavailable);
    await page.getByTestId('routines-load-more').click();
    await expect(page.getByTestId('routines-more-error')).toContainText(REFERENCE);
    await expect(items(page)).toHaveCount(20);

    await page.getByTestId('routines-load-more').click();
    await expect(items(page)).toHaveCount(21);
    await expect(page.getByTestId('routines-load-more')).toHaveCount(0);
    const last = items(page).last();
    await expect(last.getByTestId('routine-status')).toHaveText('Retirada');
    await expect(last.getByTestId('routine-retired-at')).toBeVisible();
    await expect(last.getByRole('button', { name: /Retirar/ })).toHaveCount(0);

    const cursors = simulation.listRequests.map((request) =>
      new URL(request.url()).searchParams.get('cursor'),
    );
    expect(cursors).toEqual([null, nextCursor, nextCursor]);
  });

  test('un error de la lista se informa con su referencia y se puede reintentar', async ({
    page,
  }) => {
    const { routines: simulation } = await loginAs(page);
    simulation.nextList.push(MY_ROUTINES_RESPONSES.upstreamUnavailable);
    await openRoutines(page);

    const error = page.getByTestId('state-error');
    await expect(error).toContainText(REFERENCE);
    await expect(page.getByTestId('routines-list')).toHaveCount(0);
    await error.getByRole('button', { name: 'Reintentar' }).click();
    await expect(items(page)).toHaveCount(2);
  });

  test('CA4: retira una rutina tras confirmar; se conserva como retirada', async ({ page }) => {
    const { routines: simulation } = await loginAs(page);
    await openRoutines(page);
    const target = items(page).first();
    await target.getByRole('button', { name: 'Retirar la rutina «Rutina sintética 2»' }).click();
    await expect(target).toContainText('Dejará de sugerirse');
    await target.getByRole('button', { name: 'Sí, retirar' }).click();

    await expect(target.getByTestId('routine-status')).toHaveText('Retirada');
    await expect(target.getByTestId('routine-retired-at')).toBeVisible();
    await expect(target).toContainText('Retiramos la rutina');
    await expect(target.getByRole('button', { name: /Retirar/ })).toHaveCount(0);
    await expect(items(page)).toHaveCount(2);
    expect(simulation.retireRequests).toHaveLength(1);
    expect(simulation.retireRequests[0].postDataJSON()).toEqual({ expected_version: 1 });
  });

  test('una versión vencida no retira y ofrece actualizar la lista', async ({ page }) => {
    const { routines: simulation } = await loginAs(page);
    await openRoutines(page);
    // Otra sesión cambió la rutina: la vigente es la versión 2.
    simulation.routines = simulation.routines.map((routine, index) =>
      index === 0 ? { ...routine, version: 2 } : routine,
    );
    const target = items(page).first();
    await target.getByRole('button', { name: /^Retirar la rutina/ }).click();
    await target.getByRole('button', { name: 'Sí, retirar' }).click();

    await expect(target).toContainText('no se retiró');
    await expect(target.getByTestId('routine-status')).toHaveText('Publicada');
    await target.getByRole('button', { name: 'Actualizar lista' }).click();
    await expect(items(page).first()).not.toContainText('no se retiró');

    // Con la versión vigente, el retiro sí se confirma.
    await items(page)
      .first()
      .getByRole('button', { name: /^Retirar la rutina/ })
      .click();
    await items(page).first().getByRole('button', { name: 'Sí, retirar' }).click();
    await expect(items(page).first().getByTestId('routine-status')).toHaveText('Retirada');
    expect(simulation.retireRequests.map((request) => request.postDataJSON())).toEqual([
      { expected_version: 1 },
      { expected_version: 2 },
    ]);
  });

  test('CA4: una rutina que no existe o no es propia no se retira', async ({ page }) => {
    const { routines: simulation } = await loginAs(page);
    await openRoutines(page);
    // El backend ya no la reconoce como del profesional: `404 template_not_found`.
    simulation.routines = simulation.routines.slice(1);
    const target = items(page).first();
    await target.getByRole('button', { name: /^Retirar la rutina/ }).click();
    await target.getByRole('button', { name: 'Sí, retirar' }).click();

    await expect(target).toContainText('La rutina no existe o no es tuya.');
    await expect(target).toContainText(REFERENCE);
    await expect(target.getByTestId('routine-status')).toHaveText('Publicada');
  });

  test('sin nutrition.plan.author la opción no aparece y la ruta directa se rechaza', async ({
    page,
  }) => {
    await loginAs(page, 'service_provider', [], (session) => {
      session.capabilities = {
        status: 200,
        body: {
          ...GET_CAPABILITIES_RESPONSES.serviceProvider.body,
          permissions: GET_CAPABILITIES_RESPONSES.serviceProvider.body.permissions.filter(
            (permission) => permission !== 'nutrition.plan.author',
          ),
        },
      };
    });

    await expect(page.locator('mat-sidenav [data-menu-item]').first()).toBeVisible();
    await expect(menuItem(page)).toHaveCount(0);
    await page.goto('/profesional/alimentacion/plantillas');
    await expect(page).toHaveURL(/\/acceso-no-autorizado$/);
  });

  for (const actorType of ['organizer', 'athlete']) {
    test(`el actor ${actorType} no ve la opción ni entra a las rutinas del profesional`, async ({
      page,
    }) => {
      const { routines: simulation } = await loginAs(page, actorType);
      await expect(page.locator('mat-sidenav [data-menu-item]').first()).toBeVisible();
      await expect(menuItem(page)).toHaveCount(0);

      await page.goto('/profesional/alimentacion/plantillas');
      await expect(page).toHaveURL(/\/acceso-no-autorizado$/);
      expect(simulation.listRequests).toHaveLength(0);
    });
  }
});
