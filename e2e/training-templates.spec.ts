import { Page, expect, test } from '@playwright/test';

import { GET_CAPABILITIES_RESPONSES } from '../src/testing/bff-web/capabilities.fixtures';
import {
  MY_TEMPLATES_RESPONSES,
  PUBLISH_TEMPLATE_RESPONSES,
  SIMULATED_TEMPLATES_CORRELATION_ID,
  VALID_PUBLISH_TEMPLATE_REQUEST,
  professionalTemplate,
  professionalTemplates,
} from '../src/testing/bff-web/training-templates.fixtures';
import { SessionSimulation, login, sessionFor, simulateSession } from './support/session-simulator';
import {
  TrainingTemplatesSimulation,
  simulateTrainingTemplates,
} from './support/training-templates-simulator';

/**
 * HU028 Sugerir planes de entrenamiento (web del profesional): publica plantillas
 * de plan y retira las propias en `/profesional/entrenamientos/plantillas`
 * (ADR-041). El BFF está reemplazado por el simulador del contrato bff-web
 * 0.24.0. NO es E2E integrado.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PAGE_URL = /\/profesional\/entrenamientos\/plantillas$/;
const REFERENCE = `Código de referencia: ${SIMULATED_TEMPLATES_CORRELATION_ID}`;
const DAYS: Readonly<Record<string, string>> = { MON: 'Lunes', WED: 'Miércoles', SAT: 'Sábado' };

async function loginAs(
  page: Page,
  actorType = 'service_provider',
  templates = [professionalTemplate(1), professionalTemplate(2)],
  configure: (session: SessionSimulation) => void = () => undefined,
): Promise<TrainingTemplatesSimulation> {
  const session = await simulateSession(page, sessionFor(actorType));
  configure(session);
  const simulation = await simulateTrainingTemplates(page, templates);
  await login(page);
  // El ingreso termina al llegar al inicio del actor: navegar antes perdería la sesión.
  await expect(page).toHaveURL(/\/(deportista|profesional|organizador)\/inicio$/);
  return simulation;
}

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const form = (page: Page) => page.getByTestId('template-form');
const items = (page: Page) => page.getByTestId('templates-list').locator('li[data-template]');
const session = (page: Page, index: number) => form(page).locator(`[data-session="${index}"]`);
const menuItem = (page: Page) => page.locator('mat-sidenav [data-menu-item="training-templates"]');

async function openTemplates(page: Page): Promise<void> {
  await menuItem(page).click();
  await expect(page).toHaveURL(PAGE_URL);
}

async function choose(page: Page, label: string, option: string): Promise<void> {
  // Se pulsa el campo completo: la etiqueta de un `mat-select` vacío cubre el disparador.
  await form(page)
    .locator('mat-form-field', { has: page.getByLabel(label, { exact: true }) })
    .click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

/** Llena la plantilla válida de los fixtures (tres sesiones); el título lleva espacios de sobra. */
async function fillTemplate(page: Page): Promise<void> {
  const request = VALID_PUBLISH_TEMPLATE_REQUEST;
  await form(page).getByLabel('Título', { exact: true }).fill(`  ${request.title}  `);
  await form(page).getByLabel('Objetivos', { exact: true }).fill(request.objectives);
  await choose(page, 'Deporte', 'Carrera');
  await choose(page, 'Objetivo principal', 'Rendimiento');
  await choose(page, 'Nivel', 'Principiante');
  await form(page)
    .getByLabel('Duración (semanas)', { exact: true })
    .fill(String(request.duration_weeks));
  for (const [index, item] of request.weekly_sessions.entries()) {
    const n = index + 1;
    if (index > 0) {
      await button(page, 'Agregar sesión').click();
    }
    await choose(page, `Día de la sesión ${n}`, DAYS[item.day_of_week]);
    await form(page)
      .getByLabel(`Duración de la sesión ${n} (minutos)`)
      .fill(String(item.duration_minutes));
    await form(page).getByLabel(`Descripción de la sesión ${n}`).fill(item.description);
  }
}

test.describe('HU028 Plantillas de entrenamiento del profesional (simulador del contrato) @simulado', () => {
  test('CA4: publica una plantilla con varias sesiones y la ve primera en su lista', async ({
    page,
  }) => {
    const simulation = await loginAs(page);
    await openTemplates(page);
    await expect(items(page)).toHaveCount(2);

    await button(page, 'Publicar una plantilla').click();
    await fillTemplate(page);
    await button(page, 'Publicar plantilla').click();

    await expect(page.getByTestId('template-published')).toHaveText(
      /Publicamos la plantilla «Base aeróbica para 10K»/,
    );
    await expect(page.getByTestId('template-published')).toBeFocused();
    await expect(page.getByTestId('template-published-replayed')).toHaveCount(0);
    await expect(form(page)).toHaveCount(0);
    await expect(items(page)).toHaveCount(3);
    const first = items(page).first();
    await expect(first).toContainText('Base aeróbica para 10K');
    await expect(first.getByTestId('template-status')).toHaveText('Publicada');
    await expect(first.getByTestId('template-weeks')).toHaveText('8');
    const sessions = first.getByTestId('template-sessions-list');
    await expect(sessions).toContainText('3 por semana · 155 min en total');
    await expect(sessions).toContainText('Lunes · 40 min · Trote suave continuo.');
    await expect(sessions).toContainText('Sábado · 70 min · Fondo largo a ritmo cómodo.');

    expect(simulation.publishRequests).toHaveLength(1);
    const request = simulation.publishRequests[0];
    expect(await request.headerValue('idempotency-key')).toMatch(UUID);
    // Exactamente el cuerpo del contrato: sin `professional_id` y con el título recortado.
    expect(request.postDataJSON()).toEqual(VALID_PUBLISH_TEMPLATE_REQUEST);

    // Al recargar, la plantilla llega de la consulta.
    await page.reload();
    await expect(items(page).first()).toContainText('Base aeróbica para 10K');
    await expect(items(page)).toHaveCount(3);
  });

  test('CA4: las reglas del backend se marcan en su campo y en su sesión; nada se publica', async ({
    page,
  }) => {
    const simulation = await loginAs(page);
    await openTemplates(page);
    simulation.nextPublish.push(PUBLISH_TEMPLATE_RESPONSES.validationError);
    await button(page, 'Publicar una plantilla').click();
    await fillTemplate(page);
    await button(page, 'Publicar plantilla').click();

    const errors = page.getByTestId('template-errors');
    await expect(errors).toBeFocused();
    await expect(errors.getByRole('listitem')).toHaveText([
      'Título: La longitud no es válida.',
      'Duración (semanas): El valor está fuera del rango permitido.',
      'Sesión 2 (duración): El valor está fuera del rango permitido.',
      'Sesión 3 (descripción): La longitud no es válida.',
    ]);
    await expect(
      form(page).locator('mat-form-field', { has: page.getByLabel('Título', { exact: true }) }),
    ).toContainText('La longitud no es válida.');
    await expect(session(page, 1)).toContainText('El valor está fuera del rango permitido.');
    await expect(session(page, 2)).toContainText('La longitud no es válida.');
    await expect(session(page, 0)).not.toContainText('La longitud no es válida.');
    await expect(page.getByTestId('template-published')).toHaveCount(0);
    await expect(items(page)).toHaveCount(2);
  });

  test('CA4: el formulario no envía semanas ni minutos fuera de rango', async ({ page }) => {
    const simulation = await loginAs(page);
    await openTemplates(page);
    await button(page, 'Publicar una plantilla').click();
    await fillTemplate(page);
    await form(page).getByLabel('Duración (semanas)', { exact: true }).fill('60');
    await form(page).getByLabel('Duración de la sesión 2 (minutos)').fill('5');
    await button(page, 'Publicar plantilla').click();

    await expect(form(page)).toContainText('El valor máximo permitido es 52.');
    await expect(session(page, 1)).toContainText('El valor mínimo permitido es 10.');
    expect(simulation.publishRequests).toHaveLength(0);
  });

  test('la semana tipo admite de 1 a 14 sesiones', async ({ page }) => {
    await loginAs(page);
    await openTemplates(page);
    await button(page, 'Publicar una plantilla').click();

    await expect(form(page).locator('[data-session]')).toHaveCount(1);
    await expect(button(page, 'Quitar la sesión 1')).toBeDisabled();
    for (let n = 2; n <= 14; n++) {
      await button(page, 'Agregar sesión').click();
    }
    await expect(form(page).locator('[data-session]')).toHaveCount(14);
    await expect(page.getByTestId('template-add-session')).toBeDisabled();
    await expect(button(page, 'Quitar la sesión 1')).toBeEnabled();

    await button(page, 'Quitar la sesión 14').click();
    await expect(form(page).locator('[data-session]')).toHaveCount(13);
    await expect(page.getByTestId('template-add-session')).toBeEnabled();
  });

  test('CA4: ante 503 reintenta con la misma clave y publica una sola plantilla', async ({
    page,
  }) => {
    const simulation = await loginAs(page);
    await openTemplates(page);
    simulation.nextPublish.push(PUBLISH_TEMPLATE_RESPONSES.upstreamUnavailable);
    await button(page, 'Publicar una plantilla').click();
    await fillTemplate(page);
    await button(page, 'Publicar plantilla').click();

    await expect(page.getByTestId('template-retrying')).toContainText('1 de 3');
    await expect(page.getByTestId('template-published')).toBeVisible();
    await expect(page.getByTestId('template-published-replayed')).toHaveCount(0);
    expect(simulation.publishRequests).toHaveLength(2);
    const [first, second] = await Promise.all(
      simulation.publishRequests.map((request) => request.headerValue('idempotency-key')),
    );
    expect(second).toBe(first);
    expect(
      simulation.templates.filter((template) => template.title === 'Base aeróbica para 10K'),
    ).toHaveLength(1);
  });

  test('CA4: si se perdió la respuesta, el reintento muestra la confirmación anterior sin duplicar', async ({
    page,
  }) => {
    const simulation = await loginAs(page);
    await openTemplates(page);
    simulation.lostResponses = 1;
    await button(page, 'Publicar una plantilla').click();
    await fillTemplate(page);
    await button(page, 'Publicar plantilla').click();

    await expect(page.getByTestId('template-published-replayed')).toHaveText(
      'Esta confirmación corresponde a un envío anterior: no se publicó otra plantilla.',
    );
    expect(simulation.publishRequests).toHaveLength(2);
    expect(await simulation.publishRequests[1].headerValue('idempotency-key')).toBe(
      await simulation.publishRequests[0].headerValue('idempotency-key'),
    );
    await expect(items(page)).toHaveCount(3);
    expect(
      simulation.templates.filter((template) => template.title === 'Base aeróbica para 10K'),
    ).toHaveLength(1);
  });

  test('CA4: agotados los reintentos, volver a publicar usa la misma clave', async ({ page }) => {
    test.setTimeout(60_000);
    const simulation = await loginAs(page);
    await openTemplates(page);
    // Intento inicial y tres reintentos automáticos (1, 2 y 4 s).
    simulation.nextPublish.push(
      ...Array.from({ length: 4 }, () => PUBLISH_TEMPLATE_RESPONSES.upstreamUnavailable),
    );
    await button(page, 'Publicar una plantilla').click();
    await fillTemplate(page);
    await button(page, 'Publicar plantilla').click();

    const failure = page.getByTestId('template-publish-error');
    await expect(failure).toBeFocused({ timeout: 15_000 });
    await expect(failure).toContainText('no se publicará una plantilla duplicada');
    await expect(failure).toContainText(REFERENCE);
    expect(simulation.publishRequests).toHaveLength(4);

    await button(page, 'Publicar plantilla').click();
    await expect(page.getByTestId('template-published')).toBeVisible();
    const keys = await Promise.all(
      simulation.publishRequests.map((request) => request.headerValue('idempotency-key')),
    );
    expect(new Set(keys).size).toBe(1);
  });

  test('sin plantillas muestra el estado vacío', async ({ page }) => {
    await loginAs(page, 'service_provider', []);
    await openTemplates(page);

    await expect(page.getByTestId('state-empty')).toHaveText('Aún no has publicado plantillas.');
    await expect(button(page, 'Publicar una plantilla')).toBeVisible();
  });

  test('«Cargar más» pide la página siguiente con el cursor sin modificar', async ({ page }) => {
    const simulation = await loginAs(page, 'service_provider', [
      ...professionalTemplates(20, 1),
      professionalTemplate(21, 'RETIRED'),
    ]);
    await openTemplates(page);
    await expect(items(page)).toHaveCount(20);
    const firstPage = (await (await simulation.listRequests[0].response())!.json()) as {
      next_cursor: string;
    };

    // Un fallo de la página siguiente no borra lo ya cargado.
    simulation.nextList.push(MY_TEMPLATES_RESPONSES.upstreamUnavailable);
    await page.getByTestId('templates-load-more').click();
    await expect(page.getByTestId('templates-more-error')).toContainText(REFERENCE);
    await expect(items(page)).toHaveCount(20);

    await page.getByTestId('templates-load-more').click();
    await expect(items(page)).toHaveCount(21);
    await expect(page.getByTestId('templates-load-more')).toHaveCount(0);
    await expect(page.getByTestId('templates-more-error')).toHaveCount(0);
    const last = items(page).last();
    await expect(last.getByTestId('template-status')).toHaveText('Retirada');
    await expect(last.getByTestId('template-retired-at')).toBeVisible();
    await expect(last.getByRole('button', { name: /Retirar/ })).toHaveCount(0);

    const cursors = simulation.listRequests.map((request) =>
      new URL(request.url()).searchParams.get('cursor'),
    );
    expect(cursors).toEqual([null, firstPage.next_cursor, firstPage.next_cursor]);
  });

  test('un error de la lista se informa con su referencia y se puede reintentar', async ({
    page,
  }) => {
    const simulation = await loginAs(page);
    simulation.nextList.push(MY_TEMPLATES_RESPONSES.upstreamUnavailable);
    await openTemplates(page);

    const error = page.getByTestId('state-error');
    await expect(error).toContainText(REFERENCE);
    await expect(page.getByTestId('templates-list')).toHaveCount(0);
    await error.getByRole('button', { name: 'Reintentar' }).click();
    await expect(items(page)).toHaveCount(2);
  });

  test('CA3: retira una plantilla tras confirmar; se conserva como retirada', async ({ page }) => {
    const simulation = await loginAs(page);
    await openTemplates(page);
    const target = items(page).first();
    await target
      .getByRole('button', { name: 'Retirar la plantilla «Plantilla sintética 2»' })
      .click();
    await expect(target).toContainText('Dejará de sugerirse');
    await target.getByRole('button', { name: 'Sí, retirar' }).click();

    await expect(target.getByTestId('template-status')).toHaveText('Retirada');
    await expect(target.getByTestId('template-retired-at')).toBeVisible();
    await expect(target).toContainText('Retiramos la plantilla');
    await expect(target.getByRole('button', { name: /Retirar/ })).toHaveCount(0);
    await expect(items(page)).toHaveCount(2);
    expect(simulation.retireRequests).toHaveLength(1);
    expect(simulation.retireRequests[0].postDataJSON()).toEqual({ expected_version: 1 });
  });

  test('CA3: una versión vencida no retira y ofrece actualizar la lista', async ({ page }) => {
    const simulation = await loginAs(page);
    await openTemplates(page);
    // Otra sesión cambió la plantilla: la vigente es la versión 2.
    simulation.templates = simulation.templates.map((template, index) =>
      index === 0 ? { ...template, version: 2 } : template,
    );
    const target = items(page).first();
    await target.getByRole('button', { name: /^Retirar la plantilla/ }).click();
    await target.getByRole('button', { name: 'Sí, retirar' }).click();

    await expect(target).toContainText('no se retiró');
    await expect(target.getByTestId('template-status')).toHaveText('Publicada');
    await target.getByRole('button', { name: 'Actualizar lista' }).click();
    await expect(items(page).first()).not.toContainText('no se retiró');

    // Con la versión vigente, el retiro sí se confirma.
    await items(page)
      .first()
      .getByRole('button', { name: /^Retirar la plantilla/ })
      .click();
    await items(page).first().getByRole('button', { name: 'Sí, retirar' }).click();
    await expect(items(page).first().getByTestId('template-status')).toHaveText('Retirada');
    expect(simulation.retireRequests.map((request) => request.postDataJSON())).toEqual([
      { expected_version: 1 },
      { expected_version: 2 },
    ]);
  });

  test('CA3: una plantilla que no existe o no es propia no se retira', async ({ page }) => {
    const simulation = await loginAs(page);
    await openTemplates(page);
    // El backend ya no la reconoce como del profesional: `404 template_not_found`.
    simulation.templates = simulation.templates.slice(1);
    const target = items(page).first();
    await target.getByRole('button', { name: /^Retirar la plantilla/ }).click();
    await target.getByRole('button', { name: 'Sí, retirar' }).click();

    await expect(target).toContainText('La plantilla no existe o no es tuya.');
    await expect(target).toContainText(REFERENCE);
    await expect(target.getByTestId('template-status')).toHaveText('Publicada');
  });

  test('sin training.plan.author la opción no aparece y la ruta directa se rechaza', async ({
    page,
  }) => {
    await loginAs(page, 'service_provider', [], (session) => {
      session.capabilities = {
        status: 200,
        body: {
          ...GET_CAPABILITIES_RESPONSES.serviceProvider.body,
          permissions: GET_CAPABILITIES_RESPONSES.serviceProvider.body.permissions.filter(
            (permission) => permission !== 'training.plan.author',
          ),
        },
      };
    });

    await expect(page.locator('mat-sidenav [data-menu-item]').first()).toBeVisible();
    await expect(menuItem(page)).toHaveCount(0);
    await page.goto('/profesional/entrenamientos/plantillas');
    await expect(page).toHaveURL(/\/acceso-no-autorizado$/);
  });

  for (const actorType of ['organizer', 'athlete']) {
    test(`el actor ${actorType} no ve la opción ni entra a las plantillas del profesional`, async ({
      page,
    }) => {
      const simulation = await loginAs(page, actorType);
      await expect(page.locator('mat-sidenav [data-menu-item]').first()).toBeVisible();
      await expect(menuItem(page)).toHaveCount(0);

      await page.goto('/profesional/entrenamientos/plantillas');
      await expect(page).toHaveURL(/\/acceso-no-autorizado$/);
      expect(simulation.listRequests).toHaveLength(0);
    });
  }
});
