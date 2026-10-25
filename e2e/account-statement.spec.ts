import { Page, expect, test } from '@playwright/test';

import {
  ACCOUNT_STATEMENT_RESPONSES,
  SIMULATED_STATEMENT_CORRELATION_ID,
  longHistory,
} from '../src/testing/bff-web/account-statement.fixtures';
import { FREE_SUBSCRIPTION } from '../src/testing/bff-web/affiliation.fixtures';
import {
  AccountStatementSimulation,
  NOT_APPLICABLE_DATA,
  StatementData,
  athleteDataFrom,
  simulateAccountStatement,
} from './support/account-statement-simulator';
import { simulateAccount } from './support/account-simulator';
import { AffiliationSimulation, simulateAffiliation } from './support/affiliation-simulator';
import { simulateProfile } from './support/profile-simulator';
import { login, sessionFor, simulateSession } from './support/session-simulator';

/**
 * HU007 Consultar estado de cuenta: la sección «Estado de cuenta» de «Mi perfil»
 * de cada actor, enlazada desde «Mi plan» para el deportista (ADR-036). El BFF está
 * reemplazado por el simulador del contrato bff-web 0.28.0. NO es E2E integrado.
 */

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const statement = (page: Page) => page.getByTestId('account-statement');
const movementRows = (page: Page) => statement(page).locator('tbody tr');

interface Simulations {
  readonly affiliation: AffiliationSimulation | null;
  readonly statement: AccountStatementSimulation;
}

/**
 * Inicia sesión como `actorType` con el perfil, la cuenta y el estado de cuenta
 * simulados; el deportista tiene además su suscripción (HU016).
 */
async function loginAs(
  page: Page,
  actorType: 'athlete' | 'organizer' | 'service_provider',
  options: {
    subscription?: typeof FREE_SUBSCRIPTION | null;
    data?: () => StatementData;
  } = {},
): Promise<Simulations> {
  const session = await simulateSession(page, sessionFor(actorType));
  await simulateProfile(page.context());
  await simulateAccount(page.context(), actorType);
  const affiliation =
    actorType === 'athlete'
      ? await simulateAffiliation(
          page,
          session,
          options.subscription === undefined ? FREE_SUBSCRIPTION : options.subscription,
        )
      : null;
  const data =
    options.data ?? (affiliation ? athleteDataFrom(affiliation) : () => NOT_APPLICABLE_DATA);
  const simulation = await simulateAccountStatement(page.context(), data);
  await login(page);
  // El ingreso termina al llegar al inicio del actor: navegar antes perdería la sesión.
  await expect(page).toHaveURL(/\/(deportista|profesional|organizador)\/inicio$/);
  return { affiliation, statement: simulation };
}

async function openProfile(page: Page, area: string): Promise<void> {
  await page.locator('mat-sidenav [data-menu-item="profile"]').click();
  await expect(page).toHaveURL(new RegExp(`/${area}/perfil$`));
}

test.describe('HU007 Estado de cuenta (simulador del contrato) @simulado', () => {
  test('CA1 y CA4: tras subir a PREMIUM, el deportista llega desde «Mi plan» y ve su compromiso y sus movimientos', async ({
    page,
  }) => {
    const { statement: simulation } = await loginAs(page, 'athlete');
    await page.locator('mat-sidenav [data-menu-item="plan"]').click();
    await expect(page).toHaveURL(/\/deportista\/plan$/);

    await page.locator('[data-plan="PREMIUM"]').getByRole('button', { name: 'Elegir Premium' }).click();
    await page.getByRole('radio', { name: /^Trimestral/ }).check();
    await button(page, 'Continuar').click();
    await button(page, 'Confirmar cambio').click();
    await expect(page.getByTestId('my-plan-changed')).toContainText('Ahora tienes el plan Premium.');

    await page.getByTestId('my-plan-statement-link').click();
    await expect(page).toHaveURL(/\/deportista\/perfil#estado-de-cuenta$/);
    await expect(statement(page).getByRole('heading', { level: 2 })).toBeFocused();

    await expect(page.getByTestId('account-statement-plan')).toHaveText('Premium');
    await expect(page.getByTestId('account-statement-plan-version')).toHaveText('2');
    await expect(page.getByTestId('account-statement-offer')).toHaveText('Trimestral');
    await expect(page.getByTestId('account-statement-price')).toHaveText(
      /\$\s14\.400 \(precio de referencia, pago no confirmado\)/,
    );
    await expect(page.getByTestId('account-statement-next-due')).toContainText('2027');
    await expect(page.getByTestId('account-statement-payments')).toContainText(
      'SportApp no registra pagos',
    );
    await expect(page.getByTestId('account-statement-balance')).toHaveText(
      'No disponible: SportApp no registra pagos',
    );

    const commitment = page.getByTestId('account-statement-commitments').locator('li');
    await expect(commitment).toHaveCount(1);
    await expect(commitment).toHaveAttribute('data-commitment-status', 'PENDING_EXTERNAL');
    await expect(commitment).toContainText('Pendiente de pago externo');

    await expect(movementRows(page)).toHaveCount(3);
    await expect(movementRows(page).nth(0)).toContainText('Compromiso informativo registrado');
    await expect(movementRows(page).nth(1)).toContainText('Cambio de plan');
    await expect(movementRows(page).nth(2)).toContainText('Plan gratuito activado');

    // CA3: la cuenta es la del token; no se envía ningún identificador de usuario.
    const request = simulation.requests.at(-1)!;
    expect(await request.headerValue('authorization')).toMatch(/^Bearer \S+$/);
    expect([...new URL(request.url()).searchParams.keys()]).toEqual(['limit']);
  });

  for (const { actorType, area } of [
    { actorType: 'organizer', area: 'organizador' },
    { actorType: 'service_provider', area: 'profesional' },
  ] as const) {
    test(`CA2 (${actorType}): ve NOT_APPLICABLE como estado, sin listas ni error`, async ({ page }) => {
      const { statement: simulation } = await loginAs(page, actorType);
      await openProfile(page, area);

      await expect(page.getByTestId('account-statement-not-applicable')).toContainText(
        'no tiene un plan de afiliación',
      );
      await expect(statement(page).getByRole('alert')).toHaveCount(0);
      await expect(movementRows(page)).toHaveCount(0);
      expect(simulation.requests).toHaveLength(1);
    });
  }

  test('CA2: el deportista en PROVISIONING lo ve explícito y vuelve a consultar', async ({ page }) => {
    const { affiliation } = await loginAs(page, 'athlete', { subscription: null });
    await openProfile(page, 'deportista');

    await expect(page.getByTestId('account-statement-provisioning')).toContainText(
      'Estamos activando tu plan gratuito',
    );
    affiliation!.subscription = FREE_SUBSCRIPTION;
    await statement(page).getByRole('button', { name: 'Volver a consultar' }).click();
    await expect(page.getByTestId('account-statement-plan')).toHaveText('Gratuito');
    await expect(page.getByTestId('account-statement-no-commitments')).toBeVisible();
    await expect(movementRows(page)).toHaveCount(1);
  });

  test('CA5: pagina por cursor sin pérdidas ni repeticiones', async ({ page }) => {
    const history = longHistory(25);
    const { statement: simulation } = await loginAs(page, 'athlete', {
      data: () => ({
        status: 'ACTIVE',
        subscription: FREE_SUBSCRIPTION,
        commitments: [],
        movements: history,
      }),
    });
    await openProfile(page, 'deportista');

    await expect(movementRows(page)).toHaveCount(20);
    await page.getByTestId('account-statement-load-more').click();
    await expect(movementRows(page)).toHaveCount(25);
    await expect(page.getByTestId('account-statement-load-more')).toHaveCount(0);

    const shown = await movementRows(page).allTextContents();
    expect(new Set(shown).size).toBe(25);
    await expect(movementRows(page).last()).toContainText('Plan gratuito activado');

    const [first, second] = simulation.requests.map((r) => new URL(r.url()).searchParams);
    expect(first.get('cursor')).toBeNull();
    expect(second.get('cursor')).toBe(ACCOUNT_STATEMENT_RESPONSES.firstPage.body.next_cursor);
  });

  test('un fallo transitorio se informa con su referencia y se puede reintentar', async ({ page }) => {
    const { statement: simulation } = await loginAs(page, 'athlete');
    simulation.next.push(ACCOUNT_STATEMENT_RESPONSES.upstreamUnavailable);
    await openProfile(page, 'deportista');

    const error = statement(page).getByTestId('state-error');
    await expect(error).toContainText(SIMULATED_STATEMENT_CORRELATION_ID);
    await error.getByRole('button', { name: 'Reintentar' }).click();
    await expect(page.getByTestId('account-statement-plan')).toHaveText('Gratuito');
  });
});
