import { Page, expect, test } from '@playwright/test';

import { GET_CAPABILITIES_RESPONSES } from '../src/testing/bff-web/capabilities.fixtures';
import { SimulatedResponse } from '../src/testing/bff-web/register-user.fixtures';
import {
  SERVICES_AVAILABILITY_RESPONSES,
  SIMULATED_SERVICES_CORRELATION_ID,
  catalogService,
  unavailableService,
} from '../src/testing/bff-web/services-availability.fixtures';
import {
  ServicesAvailabilitySimulation,
  simulateServicesAvailability,
} from './support/services-availability-simulator';
import { login, sessionFor, simulateSession } from './support/session-simulator';

/**
 * HU020 Visualizar disponibilidad de servicios: el deportista consulta los
 * servicios publicados y sus horarios en `/deportista/servicios`. El BFF está
 * reemplazado por el simulador del contrato bff-web 0.12.0 (ADR-038). NO es E2E
 * integrado.
 */

const TIME_ZONE = 'America/Bogota';
const DAY_MS = 86_400_000;

test.use({ timezoneId: TIME_ZONE });

/**
 * Catálogo sintético: 25 servicios con espacios (más de una página de 20), uno
 * de medicina deportiva y uno sin espacios en el periodo.
 */
const catalog = () => [
  ...Array.from({ length: 25 }, (_, index) => catalogService(index)),
  catalogService(25, 'SPORTS_MEDICINE'),
  unavailableService(26),
];

async function loginAs(
  page: Page,
  actorType: string,
  capabilities: SimulatedResponse | null = null,
): Promise<ServicesAvailabilitySimulation> {
  const session = await simulateSession(page, sessionFor(actorType));
  session.capabilities = capabilities;
  const simulation = await simulateServicesAvailability(
    page,
    catalog(),
    capabilities === GET_CAPABILITIES_RESPONSES.athletePremium,
  );
  await login(page);
  // El ingreso termina al llegar al inicio del actor: navegar antes perdería la sesión.
  await expect(page).toHaveURL(/\/(deportista|profesional|organizador)\/inicio$/);
  return simulation;
}

const menuItem = (page: Page, id: string) => page.locator(`mat-sidenav [data-menu-item="${id}"]`);

/**
 * Llega a «Servicios» por el menú, como el deportista: navegación interna sin
 * recargar la aplicación (una recarga completa vuelve a arrancar Angular y a
 * recuperar la sesión, y bajo carga supera la espera de las aserciones).
 */
async function openServices(page: Page): Promise<void> {
  await menuItem(page, 'athlete-services').click();
  await expect(page).toHaveURL(/\/deportista\/servicios$/);
}
const list = (page: Page) => page.getByTestId('availability-list');
const services = (page: Page) => list(page).locator(':scope > li');
const serviceIds = (page: Page) =>
  services(page).evaluateAll((items) => items.map((item) => item.getAttribute('data-service')));
const query = (simulation: ServicesAvailabilitySimulation, index = -1) =>
  new URL(simulation.requests.at(index)!.url()).searchParams;

/** Día local de hoy (`YYYY-MM-DD`) en la zona horaria del navegador de la prueba. */
const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

async function selectOptions(page: Page, label: string, options: string[]): Promise<void> {
  await page.getByLabel(label).click();
  for (const option of options) {
    await page.getByRole('option', { name: option }).click();
  }
  await page.keyboard.press('Escape');
}

test.describe('HU020 Visualizar disponibilidad de servicios (simulador del contrato) @simulado', () => {
  test('CA1 y CA3: el deportista FREE entra por «Servicios», ve el aviso de medicina deportiva y un periodo de 7 días', async ({
    page,
  }) => {
    const simulation = await loginAs(page, 'athlete');

    await menuItem(page, 'athlete-services').click();
    await expect(page).toHaveURL(/\/deportista\/servicios$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Servicios');
    await expect(services(page)).toHaveCount(20);

    const restricted = page.getByTestId('availability-restricted');
    await expect(restricted).toHaveText(
      'La categoría Medicina deportiva está disponible con el plan Premium. Podrás comparar los planes en «Mi plan» (Próximamente).',
    );
    await expect(restricted.locator('a')).toHaveCount(0);
    await expect(list(page)).not.toContainText('Medicina deportiva');
    await expect(page.getByTestId('availability-unavailable')).toHaveCount(0);
    // 13:00 UTC se muestra como 8:00 en la zona del navegador, que coincide con la del servicio.
    const intervals = services(page).first().getByTestId('availability-intervals');
    await expect(intervals.locator('li').first()).toContainText('8:00');
    await expect(intervals).not.toContainText('Zona horaria del servicio');

    expect(simulation.requests).toHaveLength(1);
    expect(await simulation.requests[0].headerValue('authorization')).toMatch(/^Bearer \S+$/);
    const params = query(simulation);
    expect(params.get('from')).toBe(`${today()}T00:00:00-05:00`);
    expect(params.get('to')).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00-05:00$/);
    expect(Date.parse(params.get('to')!) - Date.parse(params.get('from')!)).toBe(7 * DAY_MS);
    expect(params.get('availability')).toBe('available');
    expect(params.getAll('category')).toEqual([]);
    expect(params.get('cursor')).toBeNull();
  });

  test('CA2: filtra por categoría y modalidad con parámetros repetibles', async ({ page }) => {
    const simulation = await loginAs(page, 'athlete');
    await openServices(page);
    await expect(services(page)).toHaveCount(20);

    await selectOptions(page, 'Categoría', ['Nutrición', 'Transporte']);
    await selectOptions(page, 'Modalidad', ['Virtual']);
    await page.getByRole('button', { name: 'Buscar' }).click();

    // Nutrición (índice ≡ 1 mód 4) o Transporte (≡ 2 mód 4), y Virtual (≡ 1 mód 3).
    await expect(services(page)).toHaveCount(4);
    const params = query(simulation);
    expect(params.getAll('category')).toEqual(['NUTRITION', 'TRANSPORT']);
    expect(params.getAll('modality')).toEqual(['VIRTUAL']);
    for (const text of await services(page).allTextContents()) {
      expect(text).toMatch(/Nutrición|Transporte/);
      expect(text).toContain('Virtual');
    }
  });

  test('CA4: «Cargar más» continúa con el cursor sin pérdidas ni repeticiones', async ({
    page,
  }) => {
    const simulation = await loginAs(page, 'athlete');
    await openServices(page);
    await expect(services(page)).toHaveCount(20);
    await expect(page.getByTestId('availability-count')).toHaveText(
      'Servicios mostrados: 20. Hay más disponibles.',
    );

    await page.getByRole('button', { name: 'Cargar más' }).click();

    await expect(services(page)).toHaveCount(25);
    await expect(page.getByTestId('availability-count')).toHaveText('Servicios mostrados: 25.');
    await expect(page.getByRole('button', { name: 'Cargar más' })).toHaveCount(0);
    const expected = catalog()
      .filter((item) => item.available && item.category !== 'SPORTS_MEDICINE')
      .map((item) => item.service_id);
    expect(await serviceIds(page)).toEqual(expected);

    expect(simulation.requests).toHaveLength(2);
    expect(query(simulation, 1).get('cursor')).toBe(btoa('offset:20'));
    expect(query(simulation, 1).get('from')).toBe(query(simulation, 0).get('from'));
    expect(query(simulation, 1).get('to')).toBe(query(simulation, 0).get('to'));
  });

  test('CA2: con «servicios sin espacios» marca los que no tienen horarios en el periodo', async ({
    page,
  }) => {
    const simulation = await loginAs(page, 'athlete');
    await openServices(page);
    await expect(services(page)).toHaveCount(20);

    await page.getByLabel('Mostrar también servicios sin espacios en el periodo').check();
    // El contador ya muestra 20 por la primera consulta: hay que esperar la nueva.
    const searched = page.waitForResponse(
      (response) => new URL(response.url()).searchParams.get('availability') === 'all',
    );
    await page.getByRole('button', { name: 'Buscar' }).click();
    await searched;
    await expect(page.getByTestId('availability-count')).toHaveText(
      'Servicios mostrados: 20. Hay más disponibles.',
    );
    expect(query(simulation).get('availability')).toBe('all');

    await page.getByRole('button', { name: 'Cargar más' }).click();
    await expect(services(page)).toHaveCount(26);
    const unavailable = list(page).locator(
      `li[data-service="${unavailableService(26).service_id}"]`,
    );
    await expect(unavailable.getByTestId('availability-unavailable')).toHaveText(
      'Sin espacios en el periodo',
    );
    await expect(page.getByTestId('availability-unavailable')).toHaveCount(1);
  });

  test('un fallo del BFF se muestra con referencia y reintento, nunca como catálogo vacío', async ({
    page,
  }) => {
    const simulation = await loginAs(page, 'athlete');
    simulation.next.push(SERVICES_AVAILABILITY_RESPONSES.upstreamUnavailable);
    await openServices(page);

    const error = page.getByTestId('state-error');
    await expect(error).toContainText(SIMULATED_SERVICES_CORRELATION_ID);
    await expect(page.getByTestId('state-empty')).toHaveCount(0);
    await error.getByRole('button').click();

    await expect(services(page)).toHaveCount(20);
    expect(simulation.requests).toHaveLength(2);
  });

  test('CA1: el deportista PREMIUM entra por «Servicios médicos y deportivos» con la categoría filtrada', async ({
    page,
  }) => {
    const simulation = await loginAs(page, 'athlete', GET_CAPABILITIES_RESPONSES.athletePremium);

    await menuItem(page, 'sports-medicine').click();
    await expect(page).toHaveURL(/\/deportista\/servicios\/medico-deportivos$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Servicios médicos y deportivos',
    );
    await expect(services(page)).toHaveCount(1);
    await expect(services(page)).toContainText('Medicina deportiva');
    await expect(page.getByTestId('availability-restricted')).toHaveCount(0);
    expect(query(simulation).getAll('category')).toEqual(['SPORTS_MEDICINE']);
  });

  test('un organizador no entra a la disponibilidad de servicios del deportista', async ({
    page,
  }) => {
    const simulation = await loginAs(page, 'organizer');

    await page.goto('/deportista/servicios');

    await expect(page).toHaveURL(/\/acceso-no-autorizado$/);
    expect(simulation.requests).toHaveLength(0);
  });
});
