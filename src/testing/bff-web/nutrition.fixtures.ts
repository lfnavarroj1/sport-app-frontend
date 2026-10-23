/**
 * Simulador de las operaciones de HU014 derivado del contrato bff-web 0.18.0
 * (`src/app/core/api/contracts/bff-web.openapi.json`, ADR-037):
 * `GET /v1/food-catalog`, `POST /v1/nutrition-plans`,
 * `GET /v1/nutrition-plans/{plan_id}` y `GET /v1/me/nutrition-plans`.
 *
 * El catálogo simulado es un subconjunto de `food-catalog-2026-10-13.v1`
 * (`training_management`, `domain/nutrition/catalog.py` en `sport-app-backend`
 * `453556e`), con `label_key = "food." + food_code` en minúsculas. Los motivos
 * de `nutrition_plan_invalid` son los que enumera el contrato; las rutas de
 * `details[].field` llevan el prefijo `body.` como en HU010. Lo usan las pruebas
 * unitarias y Playwright; `nutrition.contract.spec.ts` valida cada respuesta
 * contra el esquema del contrato. Datos sintéticos.
 *
 * Archivo sin dependencias de Angular para poder importarlo desde Playwright.
 */
import { SimulatedResponse } from './register-user.fixtures';

export const FOOD_CATALOG_PATH = '/v1/food-catalog';
export const NUTRITION_PLANS_PATH = '/v1/nutrition-plans';
export const MY_NUTRITION_PLANS_PATH = '/v1/me/nutrition-plans';

export const SIMULATED_NUTRITION_ATHLETE_ID = '6a2c4e8f-1b3d-4f5a-9c7e-2d4f6b8a0c1e';
export const SIMULATED_NUTRITION_PROFESSIONAL_ID = '8b3d5f7a-9c1e-4a2b-8d4f-6e8a0c2e4f6a';
export const SIMULATED_NUTRITION_PLAN_ID = '2e4a6c8e-0b1d-4c3e-9f5a-7b9d1f3a5c7e';
export const SIMULATED_FOOD_CATALOG_VERSION = 'food-catalog-2026-10-13.v1';
/** `ETag` del catálogo simulado: la versión entre comillas, como el BFF. */
export const SIMULATED_FOOD_CATALOG_ETAG = `"${SIMULATED_FOOD_CATALOG_VERSION}"`;
const CORRELATION_ID = '9d1f3b5c-7e9a-4b1d-8f3a-5c7e9b1d3f5a';

const food = <const C extends string, const D extends string, const U extends string>(
  code: string,
  category: C,
  defaultUnit: D,
  allowedUnits: readonly U[],
  allergens: readonly string[] = [],
  incompatibleWith: readonly string[] = [],
) => ({
  food_code: code,
  label_key: `food.${code.toLowerCase()}`,
  category,
  default_unit: defaultUnit,
  allowed_units: allowedUnits,
  allergens,
  incompatible_with: incompatibleWith,
});

export const SIMULATED_FOOD_CATALOG = {
  catalog_version: SIMULATED_FOOD_CATALOG_VERSION,
  items: [
    food('OATS', 'GRAIN', 'G', ['G', 'CUP', 'TBSP']),
    food('WHOLE_WHEAT_BREAD', 'GRAIN', 'G', ['G', 'UNIT'], ['WHEAT'], ['GLUTEN_FREE', 'KETO']),
    food('CHICKEN_BREAST', 'PROTEIN', 'G', ['G'], [], ['VEGAN', 'VEGETARIAN', 'PESCATARIAN']),
    food('EGG', 'PROTEIN', 'G', ['G', 'UNIT'], ['EGGS'], ['VEGAN']),
    food('MILK', 'DAIRY', 'ML', ['ML', 'CUP'], ['MILK'], ['VEGAN', 'LACTOSE_FREE']),
    food('BANANA', 'FRUIT', 'G', ['G', 'UNIT'], [], ['KETO', 'LOW_SUGAR']),
    food('PEANUT_BUTTER', 'FAT', 'G', ['G', 'TBSP'], ['PEANUTS']),
    food('WATER', 'BEVERAGE', 'ML', ['ML', 'CUP']),
  ],
} as const;

/** Plan completo que captura el profesional en las pruebas. */
export const VALID_CREATE_NUTRITION_PLAN_REQUEST = {
  athlete_email: 'deportista@example.com',
  title: 'Recuperación tras la carrera',
  objectives: ['Mejorar la recuperación muscular', 'Mantener la hidratación'],
  start_date: '2026-11-02',
  end_date: '2026-11-29',
  meals: [
    {
      meal_type: 'BREAKFAST',
      items: [
        { food_code: 'OATS', quantity: '60', unit: 'G' },
        { food_code: 'PEANUT_BUTTER', quantity: '1.5', unit: 'TBSP' },
      ],
    },
    { meal_type: 'HYDRATION', items: [{ food_code: 'WATER', quantity: '500', unit: 'ML' }] },
  ],
} as const;

function error(
  status: number,
  code: string,
  message: string,
  details: readonly { field: string | null; issue: string }[] = [],
) {
  return { status, body: { code, message, correlation_id: CORRELATION_ID, details } } as const;
}

const invalidAccessToken = error(401, 'invalid_access_token', 'La sesión no es válida.');
const upstreamUnavailable = error(
  503,
  'upstream_unavailable',
  'El servicio no está disponible. Intente de nuevo.',
);
const upstreamTimeout = error(504, 'upstream_timeout', 'El servicio tardó demasiado en responder.');

/** Plan confirmado por el backend: cantidades normalizadas con un decimal. */
const plan = {
  plan_id: SIMULATED_NUTRITION_PLAN_ID,
  athlete_id: SIMULATED_NUTRITION_ATHLETE_ID,
  professional_id: SIMULATED_NUTRITION_PROFESSIONAL_ID,
  title: VALID_CREATE_NUTRITION_PLAN_REQUEST.title,
  objectives: VALID_CREATE_NUTRITION_PLAN_REQUEST.objectives,
  start_date: VALID_CREATE_NUTRITION_PLAN_REQUEST.start_date,
  end_date: VALID_CREATE_NUTRITION_PLAN_REQUEST.end_date,
  status: 'ASSIGNED',
  version: 1,
  catalog_version: SIMULATED_FOOD_CATALOG_VERSION,
  meals: [
    {
      meal_type: 'BREAKFAST',
      items: [
        { food_code: 'OATS', quantity: '60.0', unit: 'G' },
        { food_code: 'PEANUT_BUTTER', quantity: '1.5', unit: 'TBSP' },
      ],
    },
    { meal_type: 'HYDRATION', items: [{ food_code: 'WATER', quantity: '500.0', unit: 'ML' }] },
  ],
  created_at: '2026-10-23T15:00:00Z',
} as const;

export const FOOD_CATALOG_RESPONSES = {
  ok: { status: 200, body: SIMULATED_FOOD_CATALOG },
  notModified: { status: 304, body: null },
  invalidAccessToken,
  upstreamUnavailable,
  upstreamTimeout,
} as const satisfies Record<string, SimulatedResponse>;

export const CREATE_NUTRITION_PLAN_RESPONSES = {
  created: { status: 201, body: { ...plan, warnings: [] } },
  /** CA6: el deportista no registró hábitos; el plan se crea sin validar restricciones. */
  createdWithoutHabits: { status: 201, body: { ...plan, warnings: ['nutrition_habits_missing'] } },
  invalidAccessToken,
  permissionRequired: error(403, 'permission_required', 'No tiene permiso para crear planes.'),
  athleteAuthorizationRequired: error(
    403,
    'athlete_authorization_required',
    'El deportista no ha autorizado al profesional.',
  ),
  idempotencyKeyReused: error(
    409,
    'idempotency_key_reused',
    'La clave de idempotencia ya se usó con otra solicitud.',
  ),
  validationError: error(422, 'validation_error', 'La solicitud no es válida.', [
    { field: 'body.meals.0.items.0.quantity', issue: 'string_pattern_mismatch' },
  ]),
  /** CA2: bloqueo por alergia y por restricción, marcado por ítem. */
  nutritionPlanInvalid: error(422, 'nutrition_plan_invalid', 'El plan no cumple las reglas.', [
    { field: 'body.meals.0.items.1.food_code', issue: 'conflicts_with_allergy' },
    { field: 'body.meals.0.items.1.food_code', issue: 'conflicts_with_restriction' },
    { field: 'body.end_date', issue: 'period_too_long' },
  ]),
  upstreamUnavailable,
  upstreamTimeout,
} as const satisfies Record<string, SimulatedResponse>;

export const GET_NUTRITION_PLAN_RESPONSES = {
  found: { status: 200, body: plan },
  invalidAccessToken,
  permissionRequired: error(403, 'permission_required', 'No tiene permiso para ver el plan.'),
  athleteAuthorizationRequired: error(
    403,
    'athlete_authorization_required',
    'El deportista revocó la autorización.',
  ),
  nutritionPlanNotFound: error(404, 'nutrition_plan_not_found', 'El plan no existe.'),
  upstreamUnavailable,
  upstreamTimeout,
} as const satisfies Record<string, SimulatedResponse>;

/** Segundo plan del deportista, más antiguo, para la paginación. */
const olderPlan = {
  ...plan,
  plan_id: '4f6b8d0f-2c3e-4d5f-8a6b-9c1e3a5b7d9f',
  title: 'Base de pretemporada',
  objectives: ['Ganar masa muscular'],
  start_date: '2026-09-01',
  end_date: '2026-10-26',
  meals: [
    { meal_type: 'LUNCH', items: [{ food_code: 'CHICKEN_BREAST', quantity: '150.0', unit: 'G' }] },
  ],
  created_at: '2026-08-30T12:00:00Z',
} as const;

export const SIMULATED_NEXT_CURSOR = 'eyJjIjoiMjAyNi0xMC0yM1QxNTowMDowMFoifQ+/=';

export const MY_NUTRITION_PLANS_RESPONSES = {
  firstPage: { status: 200, body: { items: [plan], next_cursor: SIMULATED_NEXT_CURSOR } },
  lastPage: { status: 200, body: { items: [olderPlan], next_cursor: null } },
  single: { status: 200, body: { items: [plan], next_cursor: null } },
  empty: { status: 200, body: { items: [], next_cursor: null } },
  invalidAccessToken,
  permissionRequired: error(403, 'permission_required', 'Solo el deportista.'),
  invalidCursor: error(422, 'validation_error', 'El cursor no es válido.', [
    { field: 'query.cursor', issue: 'invalid_cursor' },
  ]),
  upstreamUnavailable,
  upstreamTimeout,
} as const satisfies Record<string, SimulatedResponse>;

export const SIMULATED_NUTRITION_CORRELATION_ID = CORRELATION_ID;
