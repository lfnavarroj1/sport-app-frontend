import { Page, expect, test } from '@playwright/test';

import { GET_CAPABILITIES_RESPONSES } from '../src/testing/bff-web/capabilities.fixtures';
import {
  INTEGRATED_CALENDAR_RESPONSES,
  OWN_PUBLISHED_ITEM,
} from '../src/testing/bff-web/integrated-calendar.fixtures';
import {
  IntegratedCalendarSimulation,
  simulateIntegratedCalendar,
} from './support/integrated-calendar-simulator';
import { SessionSimulation, login, sessionFor, simulateSession } from './support/session-simulator';

/**
 * HU018 Integrar servicios y eventos en calendario: cada actor ve en su
 * «Calendario» las fuentes que compone el BFF para él (ADR-039), en mes o lista,
 * con filtros por fuente, en la zona del navegador y con las fuentes incompletas
 * declaradas. El BFF está reemplazado por el simulador del contrato bff-web
 * 0.30.0. NO es E2E integrado. El navegador usa la zona de Bogotá para que las
 * horas sean estables.
 */
test.use({ timezoneId: 'America/Bogota' });

async function loginAs(
  page: Page,
  actorType: string,
  configure: (session: SessionSimulation) => void = () => undefined,
): Promise<IntegratedCalendarSimulation> {
  const session = await simulateSession(page, sessionFor(actorType));
  configure(session);
  const simulation = await simulateIntegratedCalendar(page, actorType);
  await login(page);
  // El ingreso termina al llegar al inicio del actor: navegar antes perdería la sesión.
  await expect(page).toHaveURL(/\/(deportista|profesional|organizador)\/inicio$/);
  return simulation;
}

async function openCalendar(page: Page, menuItem: string, url: RegExp, title: string) {
  await page.locator(`mat-sidenav [data-menu-item="${menuItem}"]`).click();
  await expect(page).toHaveURL(url);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
}

/** Pasa a la vista de lista y consulta marzo de 2027 completo. */
async function listMarch(page: Page): Promise<void> {
  await page.getByRole('radio', { name: 'Lista' }).click();
  await page.getByLabel('Desde').fill('2027-03-01');
  await page.getByLabel('Hasta').fill('2027-03-31');
  await page.getByRole('button', { name: 'Consultar' }).click();
}

const list = (page: Page) => page.getByTestId('integrated-list');
const titles = (page: Page) => list(page).locator('.calendar-item__title');
const sources = (page: Page) => list(page).getByTestId('calendar-item-source');

test.describe('HU018 Integrar servicios y eventos en calendario (simulador del contrato) @simulado', () => {
  test('CA1 y CA3: el organizador ve sus eventos con fuente y estado, en la zona del navegador', async ({
    page,
  }) => {
    const simulation = await loginAs(page, 'organizer');
    await openCalendar(
      page,
      'integrated-calendar',
      /\/organizador\/calendario$/,
      'Calendario integrado',
    );
    await expect(page.getByTestId('integrated-browser-zone')).toContainText('America/Bogota');
    await listMarch(page);

    await expect(titles(page)).toHaveText([
      'Media maratón de Bogotá',
      'Carrera de medianoche de Madrid',
    ]);
    await expect(sources(page)).toHaveText(['Mis eventos', 'Mis eventos']);
    await expect(list(page).getByTestId('calendar-item-status')).toHaveText([
      'Borrador',
      'Publicado',
    ]);
    const request = simulation.requests.at(-1)!;
    expect(await request.headerValue('authorization')).toMatch(/^Bearer \S+$/);
    const params = new URL(request.url()).searchParams;
    expect([...params.keys()]).toEqual(['from', 'to']);
    expect(params.get('from')).toBe('2027-03-01T05:00:00Z');
    expect(params.get('to')).toBe('2027-04-01T05:00:00Z');

    // Madrid 00:30 del 20 de marzo es el 19 de marzo a las 18:30 en Bogotá.
    const madrid = list(page).locator(`[data-item="${OWN_PUBLISHED_ITEM.item_id}"]`);
    await expect(page.locator('[data-day="2027-03-19"]')).toContainText(
      'Carrera de medianoche de Madrid',
    );
    await expect(madrid.getByTestId('calendar-item-time')).toContainText('18:30');
    await expect(madrid.getByTestId('calendar-item-zone')).toContainText('(Europe/Madrid)');
  });

  test('vista de mes: cada elemento en su día y navegación entre meses', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2027-03-15T17:00:00Z'));
    const simulation = await loginAs(page, 'organizer');
    await openCalendar(
      page,
      'integrated-calendar',
      /\/organizador\/calendario$/,
      'Calendario integrado',
    );

    await expect(page.getByTestId('integrated-month-label')).toHaveText(/marzo 2027/i);
    await expect(page.locator('td[data-day="2027-03-07"]')).toContainText(
      'Media maratón de Bogotá',
    );
    await expect(page.locator('td[data-day="2027-03-19"]')).toContainText(
      'Carrera de medianoche de Madrid',
    );
    await page.getByRole('button', { name: 'Mes siguiente' }).click();
    await expect(page.getByTestId('integrated-month-label')).toHaveText(/abril 2027/i);
    expect(new URL(simulation.requests.at(-1)!.url()).searchParams.get('from')).toBe(
      '2027-04-01T05:00:00Z',
    );
    await expect(page.getByTestId('integrated-empty')).toHaveText(
      'No tienes actividades en este periodo.',
    );
  });

  test('CA1: el profesional ve la disponibilidad de sus servicios y los eventos publicados', async ({
    page,
  }) => {
    await loginAs(page, 'service_provider');
    await openCalendar(
      page,
      'integrated-calendar',
      /\/profesional\/calendario$/,
      'Calendario integrado',
    );
    await listMarch(page);

    await expect(titles(page)).toHaveText([
      'Gran Fondo Bogotá',
      'Valoración deportiva',
      'Asesoría nutricional',
    ]);
    await expect(sources(page)).toHaveText([
      'Eventos publicados',
      'Disponibilidad de mis servicios',
      'Disponibilidad de mis servicios',
    ]);
    // Un servicio propio en borrador solo lo ve su propietario (CA4).
    await expect(list(page).getByTestId('calendar-item-status').last()).toHaveText('Borrador');

    await page.getByRole('checkbox', { name: 'Eventos publicados (1)' }).uncheck();
    await expect(titles(page)).toHaveText(['Valoración deportiva', 'Asesoría nutricional']);
  });

  test('CA1: el deportista ve eventos, sesiones, servicios asociados e inscripciones', async ({
    page,
  }) => {
    await loginAs(page, 'athlete', (session) => {
      session.capabilities = GET_CAPABILITIES_RESPONSES.athleteFree;
    });
    await openCalendar(page, 'sport-calendar', /\/deportista\/calendario$/, 'Calendario deportivo');
    await listMarch(page);

    await expect(sources(page)).toHaveText([
      'Sesiones de mis planes',
      'Eventos publicados',
      'Mis inscripciones',
      'Mis servicios asociados',
    ]);
    const session = list(page).locator('[data-source="TRAINING_PLAN_SESSION"]');
    await expect(session.getByTestId('calendar-item-time')).toHaveText('Sin hora fija');
    await expect(session).toContainText('45 min');
  });

  test('CA5: con una fuente caída entrega las demás y declara la información incompleta', async ({
    page,
  }) => {
    const simulation = await loginAs(page, 'athlete');
    await openCalendar(page, 'sport-calendar', /\/deportista\/calendario$/, 'Calendario deportivo');
    // Pasar a la lista ya consulta: el parcial se fuerza para la consulta de marzo.
    await expect(page.getByTestId('integrated-sources')).toBeVisible();
    const listed = page.waitForResponse((r) => r.url().includes('/v1/me/integrated-calendar'));
    await page.getByRole('radio', { name: 'Lista' }).click();
    await listed;
    simulation.next = INTEGRATED_CALENDAR_RESPONSES.athletePartial;
    await listMarch(page);

    const notice = page.getByTestId('integrated-incomplete');
    await expect(notice).toContainText('Sesiones de mis planes: no está disponible.');
    await expect(notice).toContainText('Mis servicios asociados: no respondió a tiempo.');
    await expect(sources(page)).toHaveText(['Eventos publicados', 'Mis inscripciones']);

    await notice.getByRole('button', { name: 'Reintentar' }).click();
    await expect(notice).toHaveCount(0);
    await expect(sources(page)).toHaveCount(4);
  });

  test('CA5: con todas las fuentes caídas muestra un error trazable con reintento', async ({
    page,
  }) => {
    const simulation = await loginAs(page, 'organizer');
    simulation.next = INTEGRATED_CALENDAR_RESPONSES.upstreamTimeout;
    await openCalendar(
      page,
      'integrated-calendar',
      /\/organizador\/calendario$/,
      'Calendario integrado',
    );

    const error = page.getByTestId('state-error');
    await expect(error).toContainText('3b8d2f6a-9c1e-4d7b-a5f3-2e8c6a4d1b9f');
    await error.getByRole('button', { name: 'Reintentar' }).click();
    await expect(page.getByTestId('integrated-month')).toBeVisible();
  });

  test('CA6: un periodo de más de 92 días no se consulta y una fuente truncada sugiere acotar', async ({
    page,
  }) => {
    const simulation = await loginAs(page, 'service_provider');
    await openCalendar(
      page,
      'integrated-calendar',
      /\/profesional\/calendario$/,
      'Calendario integrado',
    );
    await expect(page.getByTestId('integrated-sources')).toBeVisible();
    const listed = page.waitForResponse((r) => r.url().includes('/v1/me/integrated-calendar'));
    await page.getByRole('radio', { name: 'Lista' }).click();
    await listed;
    const before = simulation.requests.length;
    await page.getByLabel('Desde').fill('2027-01-01');
    await page.getByLabel('Hasta').fill('2027-04-30');
    await page.getByRole('button', { name: 'Consultar' }).click();
    await expect(page.locator('mat-error')).toContainText('supera los 92 días');
    expect(simulation.requests.length).toBe(before);

    simulation.next = INTEGRATED_CALENDAR_RESPONSES.serviceProviderTruncated;
    await listMarch(page);
    await expect(page.getByTestId('integrated-truncated')).toContainText('Acota el periodo');
    await expect(page.getByTestId('integrated-truncated')).toContainText('Eventos publicados');
  });

  test('sin la capacidad del plan, una URL directa no abre el calendario deportivo', async ({
    page,
  }) => {
    await loginAs(page, 'athlete', (session) => {
      session.capabilities = GET_CAPABILITIES_RESPONSES.athleteProvisioning;
    });
    // Navegación interna (la sesión vive en memoria y se perdería al recargar).
    await page.evaluate(() => {
      history.pushState({}, '', '/deportista/calendario');
      dispatchEvent(new PopStateEvent('popstate'));
    });

    await expect(page).toHaveURL(/\/acceso-no-autorizado$/);
  });
});
