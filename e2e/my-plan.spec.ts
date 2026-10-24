import { Page, expect, test } from '@playwright/test';

import {
  FREE_SUBSCRIPTION,
  SUBSCRIPTION_CHANGE_RESPONSES,
} from '../src/testing/bff-web/affiliation.fixtures';
import { GET_CAPABILITIES_RESPONSES } from '../src/testing/bff-web/capabilities.fixtures';
import { AffiliationSimulation, simulateAffiliation } from './support/affiliation-simulator';
import { SessionSimulation, login, sessionFor, simulateSession } from './support/session-simulator';

/**
 * HU016 «Mi plan»: el deportista compara los planes y cambia el suyo en
 * `/deportista/plan` (ADR-036). El BFF está reemplazado por el simulador del
 * contrato bff-web 0.20.0. NO es E2E integrado.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface Simulations {
  readonly session: SessionSimulation;
  readonly affiliation: AffiliationSimulation;
}

async function loginAsAthlete(
  page: Page,
  subscription: typeof FREE_SUBSCRIPTION | null = FREE_SUBSCRIPTION,
): Promise<Simulations> {
  const session = await simulateSession(page, sessionFor('athlete'));
  const affiliation = await simulateAffiliation(page, session, subscription);
  await login(page);
  // El ingreso termina al llegar al inicio: navegar antes perdería la sesión.
  await expect(page).toHaveURL(/\/deportista\/inicio$/);
  return { session, affiliation };
}

const menuItem = (page: Page, id: string) => page.locator(`mat-sidenav [data-menu-item="${id}"]`);
const plan = (page: Page, code: string) => page.locator(`[data-plan="${code}"]`);
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

async function openMyPlan(page: Page): Promise<void> {
  await menuItem(page, 'plan').click();
  await expect(page).toHaveURL(/\/deportista\/plan$/);
}

async function changePlan(page: Page, name: string, periodicity: string | null): Promise<void> {
  await page
    .locator('[data-plan]')
    .getByRole('button', { name: `Elegir ${name}` })
    .click();
  if (periodicity) {
    await page.getByRole('radio', { name: new RegExp(`^${periodicity}`) }).check();
  }
  await button(page, 'Continuar').click();
  await button(page, 'Confirmar cambio').click();
}

test.describe('HU016 Mi plan (simulador del contrato) @simulado', () => {
  test('CA7: el deportista FREE ve su plan actual y compara los tres planes', async ({ page }) => {
    const { affiliation } = await loginAsAthlete(page);
    await expect(menuItem(page, 'plan')).toHaveAttribute('href', '/deportista/plan');
    await openMyPlan(page);

    await expect(page.getByTestId('my-plan-current-name')).toHaveText('Gratuito');
    await expect(page.getByTestId('my-plan-current-price')).toHaveText('Sin costo');
    await expect(page.locator('[data-plan]')).toHaveCount(3);
    await expect(plan(page, 'FREE').getByTestId('my-plan-current-badge')).toHaveText('Plan actual');
    await expect(plan(page, 'PREMIUM').getByTestId('my-plan-offers')).toContainText(
      /Trimestral: \$\s14\.400/,
    );
    await expect(plan(page, 'PREMIUM').getByTestId('my-plan-own-capabilities')).toContainText(
      'Servicios médicos y deportivos',
    );
    await expect(plan(page, 'INTERMEDIATE').getByTestId('my-plan-own-capabilities')).toContainText(
      'Monitoreo en tiempo real',
    );
    await expect(plan(page, 'FREE').getByRole('button')).toHaveCount(0);
    expect(affiliation.plansRequests).toHaveLength(1);
    expect(affiliation.subscriptionRequests).toHaveLength(1);
  });

  test('CA1, CA6 y CA8: sube a PREMIUM trimestral, el menú se amplía y al volver a FREE se reduce', async ({
    page,
  }) => {
    const { session, affiliation } = await loginAsAthlete(page);
    await expect(menuItem(page, 'sports-medicine')).toHaveCount(0);
    await openMyPlan(page);
    const capabilityRequests = session.capabilityRequests.length;

    await plan(page, 'PREMIUM').getByRole('button', { name: 'Elegir Premium' }).click();
    await button(page, 'Continuar').click();
    await expect(page.getByTestId('my-plan-periodicity-missing')).toBeVisible();
    await page.getByRole('radio', { name: /^Trimestral/ }).check();
    await button(page, 'Continuar').click();
    const confirm = page.getByTestId('my-plan-confirm');
    await expect(confirm.getByTestId('my-plan-confirm-price')).toHaveText(/\$\s14\.400/);
    await expect(confirm.getByTestId('my-plan-gained').locator('li')).toHaveCount(5);
    await expect(confirm.getByTestId('my-plan-payment-notice')).toHaveText(
      'SportApp no procesa el pago; se registra un compromiso informativo.',
    );
    await button(page, 'Confirmar cambio').click();

    await expect(page.getByTestId('my-plan-changed')).toContainText(
      'Ahora tienes el plan Premium.',
    );
    await expect(page.getByTestId('my-plan-result-payment')).toContainText(
      'compromiso informativo pendiente de pago externo',
    );
    await expect(page.getByTestId('my-plan-current-periodicity')).toHaveText('Trimestral');
    expect(affiliation.changeRequests).toHaveLength(1);
    const request = affiliation.changeRequests[0];
    expect(request.postDataJSON()).toEqual({
      plan_code: 'PREMIUM',
      periodicity: 'QUARTERLY',
      expected_subscription_version: 1,
    });
    expect(await request.headerValue('idempotency-key')).toMatch(UUID);

    // CA8: el menú se reconstruye con las capacidades nuevas, sin volver a iniciar sesión.
    await expect(menuItem(page, 'sports-medicine')).toHaveAttribute(
      'href',
      '/deportista/servicios/medico-deportivos',
    );
    await expect(page.getByTestId('my-plan-menu-status')).toHaveText(
      'Tu menú ya muestra las opciones de tu plan.',
    );
    expect(session.capabilityRequests.length).toBeGreaterThan(capabilityRequests);
    expect(session.logins).toHaveLength(1);

    // CA6: volver a FREE retira las opciones pagas.
    await plan(page, 'FREE').getByRole('button', { name: 'Elegir Gratuito' }).click();
    await expect(page.getByRole('radio')).toHaveCount(0);
    await button(page, 'Continuar').click();
    await expect(page.getByTestId('my-plan-lost').locator('li')).toHaveCount(5);
    await expect(page.getByTestId('my-plan-payment-notice')).toContainText('quedan sin efecto');
    await button(page, 'Confirmar cambio').click();
    await expect(page.getByTestId('my-plan-result-payment')).toContainText('quedaron sin efecto');
    await expect(page.getByTestId('my-plan-current-name')).toHaveText('Gratuito');
    await expect(menuItem(page, 'sports-medicine')).toHaveCount(0);
    expect(affiliation.changeRequests[1].postDataJSON()).toEqual({
      plan_code: 'FREE',
      periodicity: 'NONE',
      expected_subscription_version: 2,
    });

    // Una URL escrita no omite la guarda tras bajar de plan.
    await page.goto('/deportista/servicios/medico-deportivos');
    await expect(page).toHaveURL(/\/acceso-no-autorizado$/);
  });

  test('CA4: un conflicto de versión se informa y se recarga el plan vigente', async ({ page }) => {
    const { affiliation } = await loginAsAthlete(page);
    await openMyPlan(page);
    affiliation.nextChange.push(SUBSCRIPTION_CHANGE_RESPONSES.versionConflict);
    await changePlan(page, 'Intermedio', 'Mensual');

    const error = page.getByTestId('my-plan-error');
    await expect(error).toContainText('Tu plan cambió mientras lo revisabas');
    await expect(error).toContainText('Código de referencia');
    await expect(page.getByTestId('my-plan-current-name')).toHaveText('Gratuito');
    await error.getByRole('button', { name: 'Recargar mi plan' }).click();
    await expect(page.getByTestId('my-plan-selection')).toHaveCount(0);
    expect(affiliation.subscriptionRequests).toHaveLength(2);
  });

  test('CA3: el mismo plan y periodicidad se rechaza con su propio mensaje', async ({ page }) => {
    const { affiliation } = await loginAsAthlete(page);
    await openMyPlan(page);
    affiliation.nextChange.push(SUBSCRIPTION_CHANGE_RESPONSES.subscriptionUnchanged);
    await changePlan(page, 'Premium', 'Anual');

    await expect(page.getByTestId('my-plan-error')).toContainText(
      'Ya tienes ese plan con esa periodicidad',
    );
  });

  test('un fallo transitorio se reintenta solo con la misma clave', async ({ page }) => {
    const { affiliation } = await loginAsAthlete(page);
    await openMyPlan(page);
    affiliation.nextChange.push(SUBSCRIPTION_CHANGE_RESPONSES.upstreamUnavailable);
    await changePlan(page, 'Premium', 'Mensual');

    await expect(page.getByTestId('my-plan-changed')).toBeVisible();
    expect(affiliation.changeRequests).toHaveLength(2);
    const [first, second] = await Promise.all(
      affiliation.changeRequests.map((request) => request.headerValue('idempotency-key')),
    );
    expect(second).toBe(first);
  });

  test('PROVISIONING: no permite elegir hasta que el plan gratuito esté activo', async ({
    page,
  }) => {
    const { session, affiliation } = await loginAsAthlete(page, null);
    await openMyPlan(page);

    await expect(page.getByTestId('my-plan-provisioning')).toContainText(
      'Estamos activando tu plan gratuito',
    );
    await expect(page.locator('[data-plan] button')).toHaveCount(0);

    affiliation.subscription = FREE_SUBSCRIPTION;
    session.capabilities = GET_CAPABILITIES_RESPONSES.athleteFree;
    await button(page, 'Volver a consultar').click();
    await expect(page.getByTestId('my-plan-current-name')).toHaveText('Gratuito');
    await expect(plan(page, 'PREMIUM').getByRole('button')).toHaveText('Elegir Premium');
  });

  test('guardas: un deportista FREE no abre una opción PREMIUM por URL directa', async ({
    page,
  }) => {
    await loginAsAthlete(page);

    await page.goto('/deportista/servicios/medico-deportivos');
    await expect(page).toHaveURL(/\/acceso-no-autorizado$/);
  });
});
