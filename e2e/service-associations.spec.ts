import { Page, expect, test } from '@playwright/test';

import { GET_CAPABILITIES_RESPONSES } from '../src/testing/bff-web/capabilities.fixtures';
import { SERVICE_ASSOCIATIONS_PATH } from '../src/testing/bff-web/service-associations.fixtures';
import { catalogService } from '../src/testing/bff-web/services-availability.fixtures';
import {
  ServiceAssociationsSimulation,
  simulateServiceAssociations,
} from './support/service-associations-simulator';
import { simulateServicesAvailability } from './support/services-availability-simulator';
import { login, sessionFor, simulateSession } from './support/session-simulator';

/**
 * HU017 Asociar servicios médicos deportivos: el deportista `PREMIUM` asocia y
 * quita servicios desde «Servicios médicos y deportivos» y consulta «Mis
 * servicios asociados». El BFF está reemplazado por los simuladores del contrato
 * bff-web 0.25.0 (ADR-038). NO es E2E integrado.
 */

test.use({ timezoneId: 'America/Bogota' });

const MEDICAL = catalogService(0, 'SPORTS_MEDICINE');
const OTHER_MEDICAL = catalogService(1, 'SPORTS_MEDICINE');
const catalog = () => [MEDICAL, OTHER_MEDICAL, catalogService(2)];

async function loginPremium(page: Page, premium = true): Promise<ServiceAssociationsSimulation> {
  const session = await simulateSession(page, sessionFor('athlete'));
  session.capabilities = GET_CAPABILITIES_RESPONSES.athletePremium;
  await simulateServicesAvailability(page, catalog(), true);
  const simulation = await simulateServiceAssociations(page, catalog(), premium);
  await login(page);
  await expect(page).toHaveURL(/\/deportista\/inicio$/);
  return simulation;
}

async function openMedical(page: Page): Promise<void> {
  await page.locator('mat-sidenav [data-menu-item="sports-medicine"]').click();
  await expect(page).toHaveURL(/\/deportista\/servicios\/medico-deportivos$/);
}

const service = (page: Page, id: string) =>
  page.locator(`[data-testid="availability-list"] > li[data-service="${id}"]`);
const associations = (page: Page) => page.locator('[data-testid="associations-list"] > li');
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const posts = (simulation: ServiceAssociationsSimulation) =>
  simulation.requests.filter((request) => request.method() === 'POST');

test.describe('HU017 Asociar servicios médicos deportivos @simulado', () => {
  test('CA1 y CA4: asocia un servicio médico tras confirmar y aparece en «Mis servicios asociados»', async ({
    page,
  }) => {
    const simulation = await loginPremium(page);
    await openMedical(page);

    await expect(page.getByRole('heading', { name: 'Mis servicios asociados' })).toBeVisible();
    await expect(page.getByTestId('associations-privacy')).toContainText(
      'no comparte tus datos de salud con el profesional',
    );
    await expect(page.getByTestId('state-empty').first()).toContainText(
      'Aún no tienes servicios médicos deportivos asociados.',
    );
    await expect(service(page, catalogService(2).service_id)).toHaveCount(0);

    await button(page, `Asociar ${MEDICAL.name}`).click();
    const confirm = service(page, MEDICAL.service_id).getByTestId('association-confirm');
    await expect(confirm).toContainText(`¿Asociar «${MEDICAL.name}» a tu perfil?`);
    await expect(confirm).toContainText('no contrata, no reserva ni paga');
    expect(posts(simulation)).toHaveLength(0);
    await button(page, 'Sí, asociar').click();

    await expect(service(page, MEDICAL.service_id).getByTestId('association-badge')).toHaveText(
      'Asociado a tu perfil',
    );
    await expect(associations(page)).toHaveCount(1);
    await expect(associations(page).first()).toContainText(MEDICAL.name);
    await expect(page.getByTestId('associations-notice')).toContainText(
      `Asociaste «${MEDICAL.name}» a tu perfil.`,
    );
    const [post] = posts(simulation);
    expect(post.postDataJSON()).toEqual({ service_id: MEDICAL.service_id });
    expect(await post.headerValue('idempotency-key')).toMatch(/^[0-9a-f-]{36}$/);
    expect(simulation.associations).toHaveLength(1);
  });

  test('CA3: si se pierde la respuesta reintenta con la misma clave y no duplica', async ({
    page,
  }) => {
    const simulation = await loginPremium(page);
    await openMedical(page);
    await expect(page.getByTestId('state-empty').first()).toBeVisible();
    simulation.next.push({
      status: 503,
      body: { code: 'upstream_unavailable', message: 'simulado', correlation_id: null },
    });

    await button(page, `Asociar ${MEDICAL.name}`).click();
    await button(page, 'Sí, asociar').click();

    await expect(associations(page)).toHaveCount(1);
    const keys = await Promise.all(posts(simulation).map((r) => r.headerValue('idempotency-key')));
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect(simulation.associations).toHaveLength(1);
  });

  test('CA3: una asociación activa existente se informa y se resalta sin duplicarla', async ({
    page,
  }) => {
    const simulation = await loginPremium(page);
    await openMedical(page);
    await expect(page.getByTestId('state-empty').first()).toBeVisible();
    // Otra pestaña asoció el servicio mientras esta ya estaba abierta.
    simulation.associations.unshift({
      association_id: '9e1a3c5e-7a9c-4e1a-8c3e-000000000500',
      service_id: MEDICAL.service_id,
      service: {
        name: MEDICAL.name,
        category: MEDICAL.category,
        modality: MEDICAL.modality,
        fee: MEDICAL.price,
      },
      status: 'ACTIVE',
      associated_at: '2026-10-20T15:00:00Z',
      ended_at: null,
      version: 1,
    });

    await button(page, `Asociar ${MEDICAL.name}`).click();
    await button(page, 'Sí, asociar').click();

    await expect(service(page, MEDICAL.service_id).getByTestId('association-message')).toHaveText(
      'Este servicio ya estaba asociado a tu perfil.',
    );
    await expect(associations(page)).toHaveCount(1);
    await expect(associations(page).first()).toHaveClass(/associations__item--highlighted/);
    expect(simulation.associations).toHaveLength(1);
  });

  test('CA5: quita una asociación tras confirmar y la conserva en el historial', async ({
    page,
  }) => {
    const simulation = await loginPremium(page);
    await openMedical(page);
    await button(page, `Asociar ${OTHER_MEDICAL.name}`).click();
    await button(page, 'Sí, asociar').click();
    await expect(associations(page)).toHaveCount(1);

    await associations(page)
      .first()
      .getByRole('button', { name: `Quitar ${OTHER_MEDICAL.name}` })
      .click();
    await expect(associations(page).first()).toContainText('Seguirá en tu historial');
    await button(page, 'Sí, quitar').click();

    await expect(page.getByTestId('associations-notice')).toContainText(
      `Quitaste «${OTHER_MEDICAL.name}». La asociación queda en tu historial.`,
    );
    await expect(associations(page)).toHaveCount(0);
    await expect(button(page, `Asociar ${OTHER_MEDICAL.name}`)).toBeVisible();
    expect(simulation.requests.filter((r) => r.method() === 'DELETE')).toHaveLength(1);

    await page.getByTestId('associations-history').getByRole('checkbox').check();
    await expect(associations(page)).toHaveCount(1);
    await expect(associations(page).first()).toContainText('Quitado');
    await expect(associations(page).first().getByTestId('association-ended-at')).toBeVisible();
    const lastGet = simulation.requests.filter((r) => r.method() === 'GET').at(-1)!;
    expect(new URL(lastGet.url()).searchParams.get('status')).toBe('ALL');
  });

  test('CA2: si el plan ya no incluye la capacidad lo explica y lleva a «Comparar planes»', async ({
    page,
  }) => {
    await loginPremium(page, false);
    await openMedical(page);

    const notice = page.getByTestId('associations-capability');
    await expect(notice).toContainText('no incluye los servicios médicos y deportivos');
    await expect(page.getByTestId('association-action')).toHaveCount(0);
    await notice.getByRole('link', { name: 'Comparar planes' }).click();
    await expect(page).toHaveURL(/\/deportista\/plan$/);
  });

  test('«Servicios» sin la opción Premium no consulta ni muestra asociaciones', async ({
    page,
  }) => {
    const simulation = await loginPremium(page);
    await page.locator('mat-sidenav [data-menu-item="athlete-services"]').click();
    await expect(page).toHaveURL(/\/deportista\/servicios$/);
    await expect(page.getByTestId('availability-list')).toBeVisible();

    await expect(page.getByTestId('my-associations')).toHaveCount(0);
    await expect(page.getByTestId('association-action')).toHaveCount(0);
    expect(
      simulation.requests.filter((r) => new URL(r.url()).pathname === SERVICE_ASSOCIATIONS_PATH),
    ).toHaveLength(0);
  });
});
