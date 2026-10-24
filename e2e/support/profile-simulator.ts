import { BrowserContext, Page, Request, Route } from '@playwright/test';

import {
  DEMOGRAPHIC_PROFILE_PATH,
  DEMOGRAPHIC_RESPONSES,
  GET_PROFILE_RESPONSES,
  NUTRITION_HABITS_PATH,
  NUTRITION_HABITS_RESPONSES,
  PHYSIOLOGICAL_PROFILE_PATH,
  PHYSIOLOGICAL_RESPONSES,
  PROFILE_PATH,
  SIMULATED_HEALTH_CONSENT_VERSION,
  SIMULATED_PROFILE_USER_ID,
  SPORT_HABITS_PATH,
  SPORT_HABITS_RESPONSES,
} from '../../src/testing/bff-web/profile.fixtures';
import { SimulatedResponse } from '../../src/testing/bff-web/register-user.fixtures';

export interface ProfileSimulation {
  /** Solicitudes recibidas en los cuatro `PUT`, en orden de llegada. */
  readonly requests: Request[];
  /** Solicitudes recibidas en `GET /v1/me/profile`. */
  readonly reads: Request[];
  /** Respuestas de los próximos `PUT` (cualquiera de los cuatro), en orden; luego, el comportamiento normal. */
  readonly next: SimulatedResponse[];
  /** Secciones vigentes; `null` mientras no se registran. */
  readonly state: {
    demographic: Section | null;
    physiological: Section | null;
    sportHabits: Section | null;
    nutritionHabits: Section | null;
  };
}

type Section = Readonly<Record<string, unknown>> & { readonly version: number };
type SectionName = 'demographic' | 'physiological' | 'sportHabits' | 'nutritionHabits';

const RESPONSES: Readonly<Record<SectionName, Readonly<Record<string, SimulatedResponse>>>> = {
  demographic: DEMOGRAPHIC_RESPONSES,
  physiological: PHYSIOLOGICAL_RESPONSES,
  sportHabits: SPORT_HABITS_RESPONSES,
  nutritionHabits: NUTRITION_HABITS_RESPONSES,
};

/** Catálogos de HU006 (ADR-034), en su orden: el backend normaliza las listas a este orden. */
const SPORTS = ['running', 'cycling', 'swimming', 'strength', 'other'];
const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const TIME_SLOTS = ['MORNING', 'AFTERNOON', 'EVENING', 'NIGHT'];
const MAX_SPORTS = 5;
/** Catálogos de HU009 (ADR-035), en su orden. */
const RESTRICTIONS = [
  'GLUTEN_FREE',
  'LACTOSE_FREE',
  'LOW_SODIUM',
  'LOW_SUGAR',
  'KETO',
  'HALAL',
  'KOSHER',
];
const ALLERGIES = [
  'PEANUTS',
  'TREE_NUTS',
  'MILK',
  'EGGS',
  'WHEAT',
  'SOY',
  'FISH',
  'SHELLFISH',
  'SESAME',
];
interface Detail {
  readonly field: string | null;
  readonly issue: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Decimal de la solicitud (`weight_kg`, `body_temperature_c`) del contrato. */
const DECIMAL = /^(\d{1,3})(?:\.(\d))?$/;

/**
 * Reemplaza las cinco operaciones del perfil de HU005, HU006 y HU009 con el
 * simulador del contrato bff-web 0.21.0, ADR-034 y ADR-035. Con el contexto como `target`, todas
 * sus pestañas comparten el mismo perfil (conflictos de versión entre pestañas).
 *
 * Como el BFF: sin `Bearer` responde `401`; los `PUT` exigen `Idempotency-Key`
 * UUID; la misma clave con el mismo cuerpo devuelve la respuesta original con
 * `Idempotent-Replayed: true` y con otro cuerpo, `409 idempotency_key_reused`.
 * Solo se recuerdan las respuestas confirmadas (`200`/`201`), así que un
 * reintento tras un `503` se procesa como el primero. `expected_version` debe
 * ser la versión vigente cuando la sección existe y omitirse cuando no existe
 * (`409 version_conflict` con la versión vigente, o `"0"`). El consentimiento
 * fisiológico debe traer la versión vigente y el cuerpo nunca `bmi` ni
 * `user_id` (`422 validation_error`). El IMC lo calcula el simulador como el
 * backend. Los hábitos rechazan un deporte repetido (`sports[i].sport`) o más de
 * cinco (`sports`), y se guardan con deportes, días y franjas en el orden de su
 * catálogo, como el backend. Los hábitos alimenticios exigen el consentimiento
 * vigente, rechazan valores repetidos o fuera del catálogo en restricciones y
 * alergias (`allergies[i]`) y se guardan con las listas en el orden del catálogo
 * y la hidratación con un decimal. Las demás reglas de ADR-034 y ADR-035 se
 * fuerzan con `next`.
 */
export async function simulateProfile(target: Page | BrowserContext): Promise<ProfileSimulation> {
  const simulation: ProfileSimulation = {
    requests: [],
    reads: [],
    next: [],
    state: { demographic: null, physiological: null, sportHabits: null, nutritionHabits: null },
  };
  const replays = new Map<string, { body: string; response: SimulatedResponse }>();
  let clock = Date.parse('2026-10-12T13:05:00Z');
  // Instantes sintéticos y crecientes, en UTC con `Z` y precisión de segundos.
  const now = () => new Date((clock += 60_000)).toISOString().replace('.000Z', 'Z');

  await target.route(`**${PROFILE_PATH}`, async (route) => {
    if (route.request().method() !== 'GET') {
      return route.fallback();
    }
    simulation.reads.push(route.request());
    if (!(await authenticated(route))) {
      return fulfill(route, GET_PROFILE_RESPONSES.invalidAccessToken);
    }
    const { demographic, physiological, sportHabits, nutritionHabits } = simulation.state;
    await fulfill(route, {
      status: 200,
      body: {
        user_id: SIMULATED_PROFILE_USER_ID,
        demographic,
        physiological,
        sport_habits: sportHabits,
        nutrition_habits: nutritionHabits,
        versions: {
          demographic: demographic?.version ?? null,
          physiological: physiological?.version ?? null,
          sport_habits: sportHabits?.version ?? null,
          nutrition_habits: nutritionHabits?.version ?? null,
        },
        projected_at: demographic || physiological || sportHabits || nutritionHabits ? now() : null,
      },
    });
  });

  const command = (name: SectionName) => async (route: Route) => {
    if (route.request().method() !== 'PUT') {
      return route.fallback();
    }
    simulation.requests.push(route.request());
    const responses = RESPONSES[name];
    if (!(await authenticated(route))) {
      return fulfill(route, responses.invalidAccessToken);
    }
    const queued = simulation.next.shift();
    if (queued) {
      return fulfill(route, queued);
    }
    const key = (await route.request().headerValue('idempotency-key')) ?? '';
    if (!UUID.test(key)) {
      return fulfill(
        route,
        withDetails(responses.validationError, [{ field: 'Idempotency-Key', issue: 'required' }]),
      );
    }
    const body = route.request().postData() ?? '';
    const previous = replays.get(`${name}:${key}`);
    if (previous) {
      return previous.body === body
        ? fulfill(route, previous.response, { 'Idempotent-Replayed': 'true' })
        : fulfill(route, responses.idempotencyKeyReused);
    }

    const request = JSON.parse(body) as Record<string, unknown>;
    const violations = rejected(name, request);
    if (violations.length > 0) {
      return fulfill(route, withDetails(responses.validationError, violations));
    }
    const current = simulation.state[name];
    const expected = request['expected_version'] ?? null;
    if (current ? expected !== current.version : expected !== null) {
      return fulfill(
        route,
        withDetails(responses.versionConflict, [
          { field: 'expected_version', issue: String(current?.version ?? 0) },
        ]),
      );
    }

    const instant = now();
    // La sección guarda lo enviado, sin `expected_version` (es del comando).
    const values = { ...request };
    delete values['expected_version'];
    const section: Section = {
      ...(name === 'demographic'
        ? values
        : name === 'physiological'
          ? physiologicalSection(values, instant)
          : name === 'nutritionHabits'
            ? nutritionHabitsSection(values, instant)
            : sportHabitsSection(values)),
      version: (current?.version ?? 0) + 1,
      created_at: (current?.['created_at'] as string | undefined) ?? instant,
      updated_at: instant,
    };
    simulation.state[name] = section;
    const response = {
      status: current ? 200 : 201,
      body: { user_id: SIMULATED_PROFILE_USER_ID, ...section },
    };
    replays.set(`${name}:${key}`, { body, response });
    await fulfill(route, response);
  };

  await target.route(`**${DEMOGRAPHIC_PROFILE_PATH}`, command('demographic'));
  await target.route(`**${PHYSIOLOGICAL_PROFILE_PATH}`, command('physiological'));
  await target.route(`**${SPORT_HABITS_PATH}`, command('sportHabits'));
  await target.route(`**${NUTRITION_HABITS_PATH}`, command('nutritionHabits'));

  return simulation;
}

/**
 * Reglas del simulador: campos no permitidos, consentimiento (CA2, CA3), la
 * forma de peso y altura que necesita el IMC (patrón y entero del contrato) y,
 * en los hábitos (HU006 CA2), deportes repetidos o de más.
 */
function rejected(name: SectionName, request: Record<string, unknown>): Detail[] {
  const details: Detail[] = ['bmi', 'user_id']
    .filter((field) => field in request)
    .map((field) => ({ field, issue: 'field_not_allowed' }));
  if (name === 'sportHabits') {
    const sports = (request['sports'] ?? []) as { sport?: unknown }[];
    if (sports.length > MAX_SPORTS) {
      details.push({ field: 'sports', issue: 'too_many_items' });
    }
    sports.forEach((item, index) => {
      if (sports.slice(0, index).some((previous) => previous.sport === item.sport)) {
        details.push({ field: `sports[${index}].sport`, issue: 'duplicate_value' });
      }
    });
  }
  if (name === 'nutritionHabits') {
    for (const [field, catalog] of [
      ['restrictions', RESTRICTIONS],
      ['allergies', ALLERGIES],
    ] as const) {
      const values = (request[field] ?? []) as unknown[];
      values.forEach((value, index) => {
        if (!catalog.includes(value as string)) {
          details.push({ field: `${field}[${index}]`, issue: 'unknown_value' });
        } else if (values.slice(0, index).includes(value)) {
          details.push({ field: `${field}[${index}]`, issue: 'duplicate_value' });
        }
      });
    }
  }
  if (name === 'physiological' || name === 'nutritionHabits') {
    const consent = (request['consent'] ?? {}) as { version?: unknown };
    if (consent.version === undefined || consent.version === null) {
      details.push({ field: 'consent.version', issue: 'required' });
    } else if (consent.version !== SIMULATED_HEALTH_CONSENT_VERSION) {
      details.push({ field: 'consent.version', issue: 'unsupported_consent_version' });
    }
  }
  if (name === 'physiological') {
    if (tenths(request['weight_kg']) === null) {
      details.push({ field: 'weight_kg', issue: 'out_of_range' });
    }
    const height = request['height_cm'];
    if (!Number.isInteger(height) || (height as number) <= 0) {
      details.push({ field: 'height_cm', issue: 'out_of_range' });
    }
  }
  return details;
}

/** Hábitos normalizados como el backend: deportes, días y franjas en el orden de su catálogo. */
function sportHabitsSection(values: Record<string, unknown>): Record<string, unknown> {
  const sports = values['sports'] as { sport: string; years_practicing?: number | null }[];
  const availability = values['availability'] as { days: string[]; time_slots: string[] };
  const byCatalog = (catalog: string[]) => (a: string, b: string) =>
    catalog.indexOf(a) - catalog.indexOf(b);
  return {
    sports: [...sports]
      .sort((a, b) => byCatalog(SPORTS)(a.sport, b.sport))
      .map((item) => ({ ...item, years_practicing: item.years_practicing ?? null })),
    availability: {
      days: [...availability.days].sort(byCatalog(DAYS)),
      time_slots: [...availability.time_slots].sort(byCatalog(TIME_SLOTS)),
    },
    primary_goal: values['primary_goal'] ?? null,
  };
}

/**
 * Hábitos alimenticios normalizados como el backend: listas en el orden de su
 * catálogo e hidratación con un decimal (`"10"` → `"10.0"`).
 */
function nutritionHabitsSection(
  values: Record<string, unknown>,
  acceptedAt: string,
): Record<string, unknown> {
  const byCatalog = (catalog: string[]) => (list: unknown) =>
    [...(list as string[])].sort((a, b) => catalog.indexOf(a) - catalog.indexOf(b));
  const hydration = tenths(values['hydration_liters_per_day']);
  return {
    consent: {
      version: (values['consent'] as { version: string }).version,
      accepted_at: acceptedAt,
    },
    diet_pattern: values['diet_pattern'],
    restrictions: byCatalog(RESTRICTIONS)(values['restrictions']),
    allergies: byCatalog(ALLERGIES)(values['allergies']),
    meals_per_day: values['meals_per_day'],
    hydration_liters_per_day: hydration === null ? null : decimal(hydration),
  };
}

/** Sección fisiológica con el consentimiento registrado y el IMC calculado. */
function physiologicalSection(
  values: Record<string, unknown>,
  acceptedAt: string,
): Record<string, unknown> {
  return {
    ...values,
    consent: {
      version: (values['consent'] as { version: string }).version,
      accepted_at: acceptedAt,
    },
    bmi: bmi(tenths(values['weight_kg'])!, values['height_cm'] as number),
  };
}

/**
 * IMC = peso / altura², con un decimal y redondeo `ROUND_HALF_UP`, en aritmética
 * entera: décimas de IMC = décimas de kg × 10 000 / cm², redondeado a la mitad
 * hacia arriba (68.5 kg y 172 cm → 23.2).
 */
function bmi(weightTenths: number, heightCm: number): string {
  const squared = heightCm * heightCm;
  return decimal(Math.floor((2 * weightTenths * 10_000 + squared) / (2 * squared)));
}

function tenths(value: unknown): number | null {
  const match = typeof value === 'string' ? DECIMAL.exec(value) : null;
  return match ? Number(match[1]) * 10 + Number(match[2] ?? '0') : null;
}

function decimal(tenthsValue: number): string {
  return `${Math.floor(tenthsValue / 10)}.${tenthsValue % 10}`;
}

/** El mismo error del contrato con otros `details`. */
function withDetails(response: SimulatedResponse, details: readonly Detail[]): SimulatedResponse {
  return { status: response.status, body: { ...(response.body as object), details } };
}

async function authenticated(route: Route): Promise<boolean> {
  return /^Bearer \S+$/.test((await route.request().headerValue('authorization')) ?? '');
}

/** CORS como el BFF: origen explícito y cabeceras del comando expuestas. */
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
      'Access-Control-Expose-Headers': 'Idempotent-Replayed, X-Correlation-ID',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}
