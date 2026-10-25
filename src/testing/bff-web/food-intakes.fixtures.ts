/**
 * Simulador de las consultas de HU013 derivado del contrato bff-web 0.32.0
 * (`src/app/core/api/contracts/bff-web.openapi.json`, ADR-037):
 * `GET /v1/me/food-intakes` y `GET /v1/athletes/{athlete_id}/food-intakes`.
 *
 * Los alimentos son los del catálogo simulado de HU014 (`nutrition.fixtures.ts`),
 * con la cantidad normalizada a un decimal como la devuelve el backend. Los motivos
 * de `422` son los que documenta el contrato (`query.to` `to_before_from` y
 * `query.cursor` `invalid_cursor`). Lo usan las pruebas unitarias y Playwright;
 * `food-intakes.contract.spec.ts` valida cada respuesta contra el esquema del
 * contrato. Datos sintéticos.
 *
 * Archivo sin dependencias de Angular para poder importarlo desde Playwright.
 */
import {
  SIMULATED_FOOD_CATALOG_VERSION,
  SIMULATED_NUTRITION_ATHLETE_ID,
} from './nutrition.fixtures';
import { SimulatedResponse } from './register-user.fixtures';

export const MY_FOOD_INTAKES_PATH = '/v1/me/food-intakes';
export const SIMULATED_INTAKES_ATHLETE_ID = SIMULATED_NUTRITION_ATHLETE_ID;
export const SIMULATED_INTAKES_NEXT_CURSOR = 'cursor-sintetico-consumos-2';

/** Ruta de los consumos de un deportista para el profesional. */
export function athleteFoodIntakesPath(athleteId: string): string {
  return `/v1/athletes/${athleteId}/food-intakes`;
}

const CORRELATION_ID = '4b6d8f0a-2c4e-4a6b-9d8f-1a3c5e7b9d0f';
const HOUR_MS = 3_600_000;

/** Tipo de comida, hora UTC y alimentos de cada consumo de un día sintético. */
const DAY_PLAN = [
  {
    meal_type: 'DINNER',
    hour: 23,
    items: [{ food_code: 'CHICKEN_BREAST', quantity: '150.0', unit: 'G' }],
  },
  {
    meal_type: 'HYDRATION',
    hour: 19,
    items: [{ food_code: 'WATER', quantity: '500.0', unit: 'ML' }],
  },
  {
    meal_type: 'LUNCH',
    hour: 17,
    items: [
      { food_code: 'EGG', quantity: '2.0', unit: 'UNIT' },
      { food_code: 'WHOLE_WHEAT_BREAD', quantity: '60.0', unit: 'G' },
    ],
  },
  {
    meal_type: 'BREAKFAST',
    hour: 12,
    items: [
      { food_code: 'OATS', quantity: '60.0', unit: 'G' },
      { food_code: 'PEANUT_BUTTER', quantity: '1.5', unit: 'TBSP' },
      { food_code: 'MILK', quantity: '1.0', unit: 'CUP' },
    ],
  },
] as const;

/**
 * Consumo sintético `index` (0 = el más reciente), en el orden del contrato
 * (`consumed_at` e `intake_id` descendentes): cuatro por día, empezando el
 * 2026-10-24 (UTC).
 */
export function foodIntake(index: number) {
  const day = Math.floor(index / DAY_PLAN.length);
  const entry = DAY_PLAN[index % DAY_PLAN.length];
  const consumed = Date.UTC(2026, 9, 24 - day, entry.hour, 15);
  return {
    intake_id: `1c3e5a7b-9d1f-4c3e-8a5b-${String(9999 - index).padStart(12, '0')}`,
    athlete_id: SIMULATED_INTAKES_ATHLETE_ID,
    consumed_at: new Date(consumed).toISOString().replace('.000Z', 'Z'),
    meal_type: entry.meal_type,
    items: entry.items.map((item) => ({ ...item })),
    catalog_version: SIMULATED_FOOD_CATALOG_VERSION,
    version: 1,
    registered_at: new Date(consumed + HOUR_MS / 4).toISOString().replace('.000Z', 'Z'),
  };
}

/** Los primeros `count` consumos en el orden del contrato. */
export function foodIntakes(count: number, offset = 0) {
  return Array.from({ length: count }, (_, index) => foodIntake(offset + index));
}

/** Consumo con un alimento que no está en el catálogo simulado (se muestra su código). */
export const INTAKE_WITH_UNKNOWN_FOOD = {
  ...foodIntake(0),
  intake_id: '1c3e5a7b-9d1f-4c3e-8a5b-000000000001',
  items: [{ food_code: 'COFFEE', quantity: '250.0', unit: 'ML' }],
};

function error(
  status: number,
  code: string,
  message: string,
  details: { field: string; issue: string }[] = [],
) {
  return {
    status,
    body: { code, message, correlation_id: CORRELATION_ID, details },
  } as const;
}

export const FOOD_INTAKES_RESPONSES = {
  /** CA5: sin consumos, colección vacía. */
  empty: { status: 200, body: { items: [], next_cursor: null } },
  /** CA1 y CA4: primera página de dos, con cursor. */
  firstPage: {
    status: 200,
    body: { items: foodIntakes(6), next_cursor: SIMULATED_INTAKES_NEXT_CURSOR },
  },
  lastPage: { status: 200, body: { items: foodIntakes(2, 6), next_cursor: null } },
  single: { status: 200, body: { items: foodIntakes(1), next_cursor: null } },
  unknownFood: { status: 200, body: { items: [INTAKE_WITH_UNKNOWN_FOOD], next_cursor: null } },
  invalidAccessToken: error(401, 'invalid_access_token', 'La sesión no es válida.'),
  permissionRequired: error(403, 'permission_required', 'No tiene permiso.'),
  /** CA3: profesional sin autorización vigente; no revela si el deportista existe. */
  athleteAuthorizationRequired: error(
    403,
    'athlete_authorization_required',
    'El deportista no ha autorizado al profesional.',
  ),
  /** CA2: periodo inválido. */
  toBeforeFrom: error(422, 'validation_error', 'Los filtros no son válidos.', [
    { field: 'query.to', issue: 'to_before_from' },
  ]),
  /** CA2: cursor corrupto. */
  invalidCursor: error(422, 'validation_error', 'El cursor no es válido.', [
    { field: 'query.cursor', issue: 'invalid_cursor' },
  ]),
  upstreamUnavailable: error(503, 'upstream_unavailable', 'El servicio no está disponible.'),
  upstreamTimeout: error(504, 'upstream_timeout', 'El servicio tardó demasiado en responder.'),
} as const satisfies Record<string, SimulatedResponse>;

export const SIMULATED_INTAKES_CORRELATION_ID = CORRELATION_ID;
