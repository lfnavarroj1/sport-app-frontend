import { Page, Request, Route } from '@playwright/test';

import {
  FREE_SUBSCRIPTION,
  MY_SUBSCRIPTION_PATH,
  PLANS_PATH,
  PLANS_RESPONSES,
  PROVISIONING_SUBSCRIPTION,
  SIMULATED_PLANS,
  SUBSCRIPTION_CHANGES_PATH,
  SUBSCRIPTION_CHANGE_RESPONSES,
  activeSubscription,
  plansResponse,
} from '../../src/testing/bff-web/affiliation.fixtures';
import { GET_CAPABILITIES_RESPONSES } from '../../src/testing/bff-web/capabilities.fixtures';
import { SimulatedResponse } from '../../src/testing/bff-web/register-user.fixtures';
import { SessionSimulation } from './session-simulator';

type SubscriptionDto = ReturnType<typeof activeSubscription>;

export interface AffiliationSimulation {
  /** Suscripción vigente; `null` mientras la gratuita se activa (`PROVISIONING`). */
  subscription: SubscriptionDto | null;
  readonly plansRequests: Request[];
  readonly subscriptionRequests: Request[];
  readonly changeRequests: Request[];
  /** Respuestas de los próximos cambios, en orden; luego, el comportamiento normal. */
  readonly nextChange: SimulatedResponse[];
}

/**
 * Reemplaza `GET /v1/plans`, `GET /v1/me/subscription` y
 * `POST /v1/me/subscription/changes` con el simulador del contrato bff-web 0.20.0
 * y ADR-036. Como el BFF: sin `Bearer` responde `401`; el plan debe existir
 * (`404 plan_not_found`); `FREE` exige `NONE` y los pagos otra periodicidad
 * (`422`); la versión esperada distinta responde `409 version_conflict`; el mismo
 * plan y periodicidad, `409 subscription_unchanged`; en `PROVISIONING`,
 * `409 subscription_provisioning`. El cambio crea la suscripción siguiente
 * (versión + 1) y la vista de `GET /v1/me/capabilities` pasa a las capacidades del
 * plan nuevo, como ocurre al consultar Afiliación. La misma clave con el mismo
 * cuerpo repite la respuesta con `Idempotent-Replayed: true`; con otro cuerpo,
 * `409 idempotency_key_reused`.
 */
export async function simulateAffiliation(
  page: Page,
  session: SessionSimulation,
  subscription: SubscriptionDto | null = FREE_SUBSCRIPTION,
): Promise<AffiliationSimulation> {
  const simulation: AffiliationSimulation = {
    subscription,
    plansRequests: [],
    subscriptionRequests: [],
    changeRequests: [],
    nextChange: [],
  };
  const byKey = new Map<string, { body: string; response: SimulatedResponse }>();
  session.capabilities = capabilitiesOf(simulation.subscription);

  const authorized = async (route: Route) =>
    /^Bearer \S+$/.test((await route.request().headerValue('authorization')) ?? '');

  await page.route(`**${PLANS_PATH}`, async (route) => {
    if (route.request().method() !== 'GET') {
      return route.fallback();
    }
    simulation.plansRequests.push(route.request());
    await fulfill(
      route,
      (await authorized(route))
        ? { status: 200, body: plansResponse(simulation.subscription?.plan_code ?? null) }
        : PLANS_RESPONSES.invalidAccessToken,
    );
  });

  await page.route(`**${MY_SUBSCRIPTION_PATH}`, async (route) => {
    if (route.request().method() !== 'GET') {
      return route.fallback();
    }
    simulation.subscriptionRequests.push(route.request());
    await fulfill(
      route,
      (await authorized(route))
        ? { status: 200, body: simulation.subscription ?? PROVISIONING_SUBSCRIPTION }
        : PLANS_RESPONSES.invalidAccessToken,
    );
  });

  await page.route(`**${SUBSCRIPTION_CHANGES_PATH}`, async (route) => {
    if (route.request().method() !== 'POST') {
      return route.fallback();
    }
    simulation.changeRequests.push(route.request());
    if (!(await authorized(route))) {
      return fulfill(route, SUBSCRIPTION_CHANGE_RESPONSES.invalidAccessToken);
    }
    const injected = simulation.nextChange.shift();
    if (injected) {
      return fulfill(route, injected);
    }
    const key = (await route.request().headerValue('idempotency-key')) ?? '';
    const body = route.request().postData() ?? '';
    const previous = byKey.get(key);
    if (previous) {
      return previous.body === body
        ? fulfill(route, previous.response, { 'Idempotent-Replayed': 'true' })
        : fulfill(route, SUBSCRIPTION_CHANGE_RESPONSES.idempotencyKeyReused);
    }
    const response = applyChange(simulation, JSON.parse(body));
    if (response.status === 200) {
      byKey.set(key, { body, response });
      session.capabilities = capabilitiesOf(simulation.subscription);
    }
    await fulfill(route, response, { 'Idempotent-Replayed': 'false' });
  });

  return simulation;
}

function applyChange(
  simulation: AffiliationSimulation,
  request: { plan_code: string; periodicity: string; expected_subscription_version: number },
): SimulatedResponse {
  const current = simulation.subscription;
  if (current === null) {
    return SUBSCRIPTION_CHANGE_RESPONSES.subscriptionProvisioning;
  }
  const plan = SIMULATED_PLANS.find((option) => option.plan_code === request.plan_code);
  if (plan === undefined) {
    return SUBSCRIPTION_CHANGE_RESPONSES.planNotFound;
  }
  const offer = plan.offers.find((option) => option.periodicity === request.periodicity);
  if (offer === undefined) {
    return SUBSCRIPTION_CHANGE_RESPONSES.inconsistentPeriodicity;
  }
  if (request.expected_subscription_version !== current.version) {
    return SUBSCRIPTION_CHANGE_RESPONSES.versionConflict;
  }
  if (current.plan_code === plan.plan_code && current.periodicity === offer.periodicity) {
    return SUBSCRIPTION_CHANGE_RESPONSES.subscriptionUnchanged;
  }
  const end =
    offer.duration_months === null
      ? null
      : new Date(Date.UTC(2026, 9 + offer.duration_months, 24, 15))
          .toISOString()
          .replace('.000', '');
  simulation.subscription = activeSubscription(
    plan.plan_code,
    offer.periodicity,
    current.version + 1,
    offer.price,
    end,
  );
  return { status: 200, body: simulation.subscription };
}

/** Vista de `GET /v1/me/capabilities` para la suscripción indicada. */
function capabilitiesOf(subscription: SubscriptionDto | null): SimulatedResponse {
  if (subscription === null) {
    return GET_CAPABILITIES_RESPONSES.athleteProvisioning;
  }
  const plan = SIMULATED_PLANS.find((option) => option.plan_code === subscription.plan_code)!;
  const { body } = GET_CAPABILITIES_RESPONSES.athleteFree;
  return {
    status: 200,
    body: {
      ...body,
      plan_code: plan.plan_code,
      plan_version: plan.version,
      catalog_version: 'plans-2026-10-13.v1',
      capabilities: plan.capabilities,
    },
  };
}

async function fulfill(
  route: Route,
  response: SimulatedResponse,
  headers: Record<string, string> = {},
): Promise<void> {
  const origin = (await route.request().headerValue('origin')) ?? '';
  await route.fulfill({
    status: response.status,
    json: response.body,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Expose-Headers': 'Idempotent-Replayed',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}
