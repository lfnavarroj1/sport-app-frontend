import { Page, expect, test } from '@playwright/test';

import { GET_CAPABILITIES_RESPONSES } from '../src/testing/bff-web/capabilities.fixtures';
import {
  ATTENDEES_DRAFT,
  ATTENDEES_EVENT,
  EVENT_ATTENDEES_RESPONSES,
  attendees,
} from '../src/testing/bff-web/event-attendees.fixtures';
import {
  EventAttendeesSimulation,
  simulateEventAttendees,
} from './support/event-attendees-simulator';
import { SessionSimulation, login, sessionFor, simulateSession } from './support/session-simulator';

/**
 * HU022 Consultar usuarios inscritos: el organizador elige uno de sus eventos en
 * `/organizador/eventos/inscritos` y ve sus inscritos con conteos, filtro y
 * paginación (ADR-039). El BFF está reemplazado por el simulador del contrato
 * bff-web 0.22.0. NO es E2E integrado.
 */

async function loginAs(
  page: Page,
  actorType = 'organizer',
  configure: (session: SessionSimulation) => void = () => undefined,
): Promise<EventAttendeesSimulation> {
  const session = await simulateSession(page, sessionFor(actorType));
  configure(session);
  const simulation = await simulateEventAttendees(page, [ATTENDEES_DRAFT, ATTENDEES_EVENT], {
    [ATTENDEES_EVENT.event_id]: attendees(23),
  });
  await login(page);
  // El ingreso termina al llegar al inicio del actor: navegar antes perdería la sesión.
  await expect(page).toHaveURL(/\/(deportista|profesional|organizador)\/inicio$/);
  return simulation;
}

const rows = (page: Page) => page.getByTestId('attendees-table').locator('tbody tr');

async function openAttendees(page: Page): Promise<void> {
  await page.locator('mat-sidenav [data-menu-item="event-attendees"]').click();
  await expect(page).toHaveURL(/\/organizador\/eventos\/inscritos$/);
}

async function chooseEvent(page: Page, name: string): Promise<void> {
  await page.getByTestId('attendees-event-select').click();
  await page.getByRole('option', { name: new RegExp(name) }).click();
}

test.describe('HU022 Consultar inscritos (simulador del contrato) @simulado', () => {
  test('CA1 y CA4: elige su evento, ve inscritos con conteos y pagina con el cursor', async ({
    page,
  }) => {
    const simulation = await loginAs(page);
    await openAttendees(page);
    await expect(page.getByTestId('attendees-choose')).toBeVisible();

    await chooseEvent(page, ATTENDEES_EVENT.name);
    await expect(page).toHaveURL(
      new RegExp(`/organizador/eventos/inscritos/${ATTENDEES_EVENT.event_id}$`),
    );
    await expect(page.getByRole('heading', { level: 2, name: /Inscritos de «/ })).toContainText(
      ATTENDEES_EVENT.name,
    );
    await expect(page.getByTestId('attendees-count-REGISTERED')).toHaveText('23');
    await expect(page.getByTestId('attendees-total')).toHaveText('23');
    await expect(rows(page)).toHaveCount(20);
    await expect(rows(page).first()).toContainText('Deportista sintético 1');
    await expect(rows(page).first()).toContainText('Inscrito');
    await expect(rows(page).first()).toContainText(/\$\s45\.000/);
    await expect(rows(page).nth(2)).toContainText('Sin tarifa');
    await expect(page.getByTestId('attendees-shown')).toHaveText(
      'Mostrando 20 de 23 inscripciones.',
    );

    const first = new URL(simulation.attendeesRequests[0].url());
    expect(first.searchParams.get('status')).toBe('REGISTERED');
    expect(first.searchParams.get('limit')).toBe('20');
    expect(first.searchParams.has('cursor')).toBe(false);
    expect(await simulation.attendeesRequests[0].headerValue('authorization')).toMatch(
      /^Bearer \S+$/,
    );

    await page.getByTestId('attendees-load-more').click();
    await expect(rows(page)).toHaveCount(23);
    await expect(rows(page).last()).toContainText('Deportista sintético 23');
    await expect(page.getByTestId('attendees-load-more')).toHaveCount(0);
    expect(new URL(simulation.attendeesRequests[1].url()).searchParams.get('cursor')).toBe(
      'inscritos-desde-20',
    );

    // CA4: cambiar el filtro vuelve a pedir la primera página con el nuevo estado.
    await page.getByTestId('attendees-filter-ALL').click();
    await expect(rows(page)).toHaveCount(20);
    const filtered = new URL(simulation.attendeesRequests[2].url());
    expect(filtered.searchParams.get('status')).toBe('ALL');
    expect(filtered.searchParams.has('cursor')).toBe(false);

    // Sin datos de contacto ni exportación.
    await expect(page.getByTestId('attendees-detail')).not.toContainText(/@|correo/i);
    await expect(page.getByRole('button', { name: /export|descarg/i })).toHaveCount(0);
  });

  test('CA3: un evento sin inscritos muestra total cero, sin tabla', async ({ page }) => {
    await loginAs(page);
    await openAttendees(page);
    await chooseEvent(page, ATTENDEES_DRAFT.name);

    await expect(page.getByTestId('attendees-empty')).toHaveText(
      'Este evento aún no tiene inscritos.',
    );
    await expect(page.getByTestId('attendees-total')).toHaveText('0');
    await expect(page.getByTestId('attendees-table')).toHaveCount(0);
  });

  test('CA6: si Usuarios no responde, muestra «Nombre no disponible» y el resto de datos', async ({
    page,
  }) => {
    const simulation = await loginAs(page);
    simulation.usersUnavailable = true;
    await openAttendees(page);
    await chooseEvent(page, ATTENDEES_EVENT.name);

    await expect(page.getByTestId('attendees-names-unavailable')).toContainText(
      'No pudimos obtener los nombres',
    );
    await expect(rows(page).first()).toContainText('Nombre no disponible');
    await expect(rows(page).first()).toContainText('Inscrito');

    simulation.usersUnavailable = false;
    await page.getByRole('button', { name: 'Volver a consultar' }).click();
    await expect(page.getByTestId('attendees-names-unavailable')).toHaveCount(0);
    await expect(rows(page).first()).toContainText('Deportista sintético 1');
  });

  test('CA2: un evento ajeno por URL directa responde sin revelar participantes', async ({
    page,
  }) => {
    const simulation = await loginAs(page);
    await openAttendees(page);
    await page.goto('/organizador/eventos/inscritos/0f1e2d3c-4b5a-4968-8778-6a5b4c3d2e1f');

    await expect(page.getByTestId('attendees-not-found')).toContainText(
      'El evento no existe o no es tuyo',
    );
    await expect(page.getByTestId('attendees-table')).toHaveCount(0);
    expect(simulation.attendeesRequests.length).toBeGreaterThan(0);
  });

  test('un error del BFF se muestra con referencia y reintento, nunca como lista vacía', async ({
    page,
  }) => {
    const simulation = await loginAs(page);
    simulation.next.push(EVENT_ATTENDEES_RESPONSES.upstreamUnavailable);
    await openAttendees(page);
    await chooseEvent(page, ATTENDEES_EVENT.name);

    await expect(page.getByTestId('state-error')).toContainText('Código de referencia');
    await expect(page.getByTestId('attendees-empty')).toHaveCount(0);
    await page.getByRole('button', { name: 'Reintentar' }).click();
    await expect(rows(page)).toHaveCount(20);
  });

  test('sin events.attendees.view la opción no aparece y la ruta directa se rechaza', async ({
    page,
  }) => {
    await loginAs(page, 'organizer', (session) => {
      session.capabilities = {
        status: 200,
        body: {
          ...GET_CAPABILITIES_RESPONSES.organizer.body,
          permissions: GET_CAPABILITIES_RESPONSES.organizer.body.permissions.filter(
            (permission) => permission !== 'events.attendees.view',
          ),
        },
      };
    });

    await expect(page.locator('mat-sidenav [data-menu-item="event-attendees"]')).toHaveCount(0);
    await page.goto('/organizador/eventos/inscritos');
    await expect(page).toHaveURL(/\/acceso-no-autorizado$/);
  });

  test('un profesional no entra a los inscritos del organizador', async ({ page }) => {
    await loginAs(page, 'service_provider');
    await page.goto('/organizador/eventos/inscritos');

    await expect(page).toHaveURL(/\/acceso-no-autorizado$/);
  });
});
