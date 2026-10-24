import { Page, expect, test } from '@playwright/test';

import { GET_CAPABILITIES_RESPONSES } from '../src/testing/bff-web/capabilities.fixtures';
import { calendarEvents } from '../src/testing/bff-web/event-calendar.fixtures';
import { EventCalendarSimulation, simulateEventCalendar } from './support/event-calendar-simulator';
import { SessionSimulation, login, sessionFor, simulateSession } from './support/session-simulator';

/**
 * HU023 Consultar calendario de eventos: el organizador ve los eventos publicados
 * del periodo en mes o lista, filtra por disciplina y ciudad y, al elegir uno de
 * sus eventos, ve las coincidencias resaltadas con su motivo (ADR-040). El BFF
 * está reemplazado por el simulador del contrato bff-web 0.18.0. NO es E2E
 * integrado. El navegador usa la zona de Bogotá para que las horas sean estables.
 */
test.use({ timezoneId: 'America/Bogota' });

async function loginAs(
  page: Page,
  actorType: string,
  configure: (session: SessionSimulation) => void = () => undefined,
): Promise<EventCalendarSimulation> {
  const session = await simulateSession(page, sessionFor(actorType));
  configure(session);
  const simulation = await simulateEventCalendar(page);
  await login(page);
  // El ingreso termina al llegar al inicio del actor: navegar antes perdería la sesión.
  await expect(page).toHaveURL(/\/(deportista|profesional|organizador)\/inicio$/);
  return simulation;
}

async function openCalendar(page: Page): Promise<void> {
  await page.locator('mat-sidenav [data-menu-item="event-calendar"]').click();
  await expect(page).toHaveURL(/\/organizador\/eventos\/calendario$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Calendario de eventos');
}

/** Pasa a la vista de lista y consulta marzo de 2027 completo. */
async function listMarch(page: Page): Promise<void> {
  await page.getByRole('radio', { name: 'Lista' }).click();
  await page.getByLabel('Desde').fill('2027-03-01');
  await page.getByLabel('Hasta').fill('2027-03-31');
  await page.getByRole('button', { name: 'Consultar' }).click();
}

const listItems = (page: Page) => page.getByTestId('calendar-list').locator('li');
const names = (page: Page) => listItems(page).locator('.calendar-event__name');

test.describe('HU023 Consultar calendario de eventos (simulador del contrato) @simulado', () => {
  test('CA1 y CA4: lista los publicados del periodo en la zona del navegador, con la zona del evento', async ({
    page,
  }) => {
    const simulation = await loginAs(page, 'organizer');
    await openCalendar(page);
    await expect(page.getByTestId('calendar-browser-zone')).toContainText('America/Bogota');
    await listMarch(page);

    await expect(names(page)).toHaveText([
      'Media maratón de Bogotá',
      'Gran Fondo Medellín',
      'Triatlón de Bogotá',
      'Carrera de la tarde',
      'Carrera nocturna de Madrid',
    ]);
    const request = simulation.calendarRequests.at(-1)!;
    expect(await request.headerValue('authorization')).toMatch(/^Bearer \S+$/);
    const params = new URL(request.url()).searchParams;
    expect([...params.keys()]).toEqual(['from', 'to', 'limit']);
    expect(params.get('from')).toBe('2027-03-01T05:00:00Z');
    expect(params.get('to')).toBe('2027-04-01T05:00:00Z');

    const first = listItems(page).first();
    await expect(first.getByTestId('calendar-event-time')).toContainText('06:00 – 10:00');
    await expect(first.getByTestId('calendar-event-zone')).toHaveText(
      'Zona del evento: America/Bogota',
    );
    // El de Madrid muestra además su hora local (20:00 CET).
    await expect(listItems(page).last().getByTestId('calendar-event-zone')).toContainText(
      '20:00 (Europe/Madrid)',
    );
    await expect(page.getByTestId('calendar-count')).toHaveText('Eventos mostrados: 5.');
  });

  test('CA1: filtra por disciplina y ciudad sin distinguir mayúsculas ni tildes', async ({
    page,
  }) => {
    const simulation = await loginAs(page, 'organizer');
    await openCalendar(page);
    await page.getByLabel('Disciplina').fill('  RUNNING ');
    await page.getByLabel('Ciudad').fill('bogota');
    await listMarch(page);

    await expect(names(page)).toHaveText(['Media maratón de Bogotá', 'Carrera de la tarde']);
    const params = new URL(simulation.calendarRequests.at(-1)!.url()).searchParams;
    expect(params.get('discipline')).toBe('RUNNING');
    expect(params.get('city')).toBe('bogota');
  });

  test('CA2: elige su borrador y ve resaltadas las coincidencias con su motivo en el mes', async ({
    page,
  }) => {
    const simulation = await loginAs(page, 'organizer');
    await openCalendar(page);

    await page.getByRole('combobox', { name: 'Mi evento' }).click();
    await page.getByRole('option', { name: /Carrera 10K Bogotá/ }).click();
    const conflicts = page.getByTestId('calendar-conflicts-list');
    await expect(conflicts.locator('li')).toHaveCount(2);
    await expect(conflicts.locator('li').first()).toContainText(
      'Coincide: misma disciplina, misma ciudad',
    );
    await expect(conflicts.locator('li').last()).toContainText('Coincide: misma ciudad');
    await expect(page.getByTestId('calendar-conflicts')).toContainText(
      'no bloquea la publicación ni reserva fechas',
    );
    expect(simulation.conflictRequests).toHaveLength(1);

    await page.getByRole('button', { name: 'Ver el mes de mi evento' }).click();
    await expect(page.getByTestId('calendar-month-label')).toHaveText('marzo 2027');
    const day = page.locator('[data-day="2027-03-01"]');
    await expect(day.locator('li')).toHaveCount(4);
    await expect(day.locator('.calendar-event--conflict .calendar-event__name')).toHaveText([
      'Media maratón de Bogotá',
      'Triatlón de Bogotá',
    ]);
    // El que se solapa sin compartir nada y el que solo toca el borde no se resaltan.
    await expect(
      day.locator('li', { hasText: 'Gran Fondo Medellín' }).getByTestId('calendar-event-conflict'),
    ).toHaveCount(0);
    await expect(
      day.locator('li', { hasText: 'Carrera de la tarde' }).getByTestId('calendar-event-conflict'),
    ).toHaveCount(0);
  });

  test('CA3: el periodo mayor de 92 días se rechaza en la web y un 422 del BFF se informa por campo', async ({
    page,
  }) => {
    const simulation = await loginAs(page, 'organizer');
    await openCalendar(page);
    await page.getByRole('radio', { name: 'Lista' }).click();
    const requests = simulation.calendarRequests.length;

    await page.getByLabel('Desde').fill('2027-03-01');
    await page.getByLabel('Hasta').fill('2027-06-15');
    await page.getByRole('button', { name: 'Consultar' }).click();
    await expect(page.locator('mat-error')).toContainText(
      'el periodo supera los 92 días permitidos.',
    );
    expect(simulation.calendarRequests).toHaveLength(requests);

    await page.getByLabel('Hasta').fill('2027-03-31');
    await page.getByLabel('Ciudad').fill('B');
    await page.getByRole('button', { name: 'Consultar' }).click();
    const violations = page.getByTestId('calendar-violations');
    await expect(violations).toContainText('Ciudad: debe tener entre 2 y 80 caracteres.');
    await expect(page.getByTestId('state-empty')).toHaveCount(0);
  });

  test('CA4: pagina con el cursor del backend sin perder ni repetir eventos', async ({ page }) => {
    const simulation = await loginAs(page, 'organizer');
    simulation.published = calendarEvents(5);
    simulation.pageSize = 2;
    await openCalendar(page);
    await listMarch(page);

    await expect(names(page)).toHaveCount(2);
    await page.getByRole('button', { name: 'Cargar más' }).click();
    await expect(names(page)).toHaveCount(4);
    await page.getByRole('button', { name: 'Cargar más' }).click();
    await expect(names(page)).toHaveText(
      Array.from({ length: 5 }, (_, i) => `Evento publicado ${i + 1}`),
    );
    await expect(page.getByRole('button', { name: 'Cargar más' })).toHaveCount(0);
    const cursors = simulation.calendarRequests
      .slice(-3)
      .map((request) => new URL(request.url()).searchParams.get('cursor'));
    expect(cursors).toEqual([null, 'p+2/=', 'p+4/=']);
  });

  test('sin events.calendar.view la opción no aparece y la ruta directa se rechaza', async ({
    page,
  }) => {
    await loginAs(page, 'organizer', (session) => {
      session.capabilities = {
        status: 200,
        body: { ...GET_CAPABILITIES_RESPONSES.organizer.body, permissions: ['events.create'] },
      };
    });
    await expect(page.locator('mat-sidenav [data-menu-item="event-calendar"]')).toHaveCount(0);

    await page.goto('/organizador/eventos/calendario');

    await expect(page).toHaveURL(/\/acceso-no-autorizado$/);
  });

  test('un profesional no entra al calendario del organizador', async ({ page }) => {
    await loginAs(page, 'service_provider');

    await page.goto('/organizador/eventos/calendario');

    await expect(page).toHaveURL(/\/acceso-no-autorizado$/);
  });
});
