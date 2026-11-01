/**
 * Simulador de HU030 derivado del contrato bff-web 0.34.0
 * (`src/app/core/api/contracts/bff-web.openapi.json`) y de ADR-041:
 * `POST /v1/nutrition-routine-templates`,
 * `POST /v1/nutrition-routine-templates/{template_id}/retire` y
 * `GET /v1/me/nutrition-routine-templates`. Los motivos de `422` son los que
 * declara el contrato (`unknown_value`, `conflicts_with_restriction`,
 * `duplicate_value`) y los de la validación de forma, con el prefijo `body.` y
 * el alimento como `daily_meals.I.items.J.food_code`. Los alimentos son los del
 * catálogo simulado de HU014 (`nutrition.fixtures.ts`). Lo usan las pruebas
 * unitarias y Playwright; `nutrition-routines.contract.spec.ts` valida cada
 * respuesta contra el esquema de su operación. Datos sintéticos.
 *
 * Archivo sin dependencias de Angular para poder importarlo desde Playwright.
 */
import { SimulatedResponse } from './register-user.fixtures';

export const ROUTINES_PATH = '/v1/nutrition-routine-templates';
export const RETIRE_ROUTINE_PATH = '/v1/nutrition-routine-templates/{template_id}/retire';
export const MY_ROUTINES_PATH = '/v1/me/nutrition-routine-templates';
export const SIMULATED_ROUTINES_PROFESSIONAL_ID = '5c7e9a1b-3d5f-4a7c-9e1b-3d5f7a9c1e3b';
const CORRELATION_ID = '4b6d8f1a-3c5e-4a7b-9d1f-4b6d8f1a3c5e';
const MINUTE_MS = 60_000;

type Status = 'PUBLISHED' | 'RETIRED';

function iso(epochMs: number): string {
  return new Date(epochMs).toISOString().replace('.000Z', 'Z');
}

/**
 * Solicitud válida de ADR-041: rutina vegetariana de 14 días con desayuno e
 * hidratación. Declara la leche; el servicio agrega el maní de la mantequilla.
 */
export const VALID_PUBLISH_ROUTINE_REQUEST = {
  title: 'Desayuno energético para fondistas',
  description: 'Rutina vegetariana con carbohidratos de absorción lenta antes de entrenar.',
  goal: 'PERFORMANCE',
  sport: 'running',
  dietary_pattern: 'VEGETARIAN',
  contains_allergens: ['MILK'],
  duration_days: 14,
  daily_meals: [
    {
      meal: 'BREAKFAST',
      items: [
        { food_code: 'OATS', portions: 2 },
        { food_code: 'PEANUT_BUTTER', portions: 1 },
      ],
    },
    { meal: 'HYDRATION', items: [{ food_code: 'WATER', portions: 4 }] },
  ],
} as const;

/** Alérgenos confirmados de la rutina válida, en el orden del catálogo de HU009. */
export const VALID_ROUTINE_CONFIRMED_ALLERGENS = ['PEANUTS', 'MILK'] as const;

/**
 * Rutina sintética `index` del profesional. El orden del contrato es
 * `created_at` descendente: un índice mayor es más antiguo.
 */
export function professionalRoutine(index: number, status: Status = 'PUBLISHED') {
  const created = Date.UTC(2026, 9, 25, 15) - index * 30 * MINUTE_MS;
  const retired = status === 'RETIRED';
  const base =
    index === 0
      ? { ...VALID_PUBLISH_ROUTINE_REQUEST, contains_allergens: VALID_ROUTINE_CONFIRMED_ALLERGENS }
      : {
          title: `Rutina sintética ${index + 1}`,
          description: 'Comidas sencillas para mantener la energía durante la semana.',
          goal: 'HEALTH' as const,
          sport: null,
          dietary_pattern: 'OMNIVORE' as const,
          contains_allergens: [] as const,
          duration_days: 7,
          daily_meals: [{ meal: 'LUNCH' as const, items: [{ food_code: 'BANANA', portions: 1 }] }],
        };
  return {
    template_id: `3a5c7e9b-1d3f-4b5c-8e7a-${String(index + 1).padStart(12, '0')}`,
    professional_id: SIMULATED_ROUTINES_PROFESSIONAL_ID,
    ...base,
    contains_allergens: [...base.contains_allergens],
    daily_meals: base.daily_meals.map((meal) => ({
      meal: meal.meal,
      items: meal.items.map((item) => ({ ...item })),
    })),
    status,
    version: retired ? 2 : 1,
    created_at: iso(created),
    updated_at: iso(retired ? created + 10 * MINUTE_MS : created),
    published_at: iso(created),
    retired_at: retired ? iso(created + 10 * MINUTE_MS) : null,
  };
}

/** Las rutinas `[from, from + count)` en el orden del contrato. */
export function professionalRoutines(count: number, from = 0) {
  return Array.from({ length: count }, (_, index) => professionalRoutine(from + index));
}

export const ROUTINES_NEXT_CURSOR = 'cursor-sintetico-rutinas-2';

function error(
  status: number,
  code: string,
  message: string,
  details: readonly { field: string | null; issue: string }[] = [],
) {
  return { status, body: { code, message, correlation_id: CORRELATION_ID, details } } as const;
}

const invalidAccessToken = error(401, 'invalid_access_token', 'La sesión no es válida.');
const permissionRequired = error(
  403,
  'permission_required',
  'Solo el profesional publica rutinas de alimentación.',
);
const upstreamUnavailable = error(503, 'upstream_unavailable', 'El servicio no está disponible.');
const upstreamTimeout = error(504, 'upstream_timeout', 'El servicio tardó demasiado en responder.');

export const MY_ROUTINES_RESPONSES = {
  firstPage: {
    status: 200,
    body: { items: professionalRoutines(20), next_cursor: ROUTINES_NEXT_CURSOR },
  },
  lastPage: {
    status: 200,
    body: {
      items: [professionalRoutine(20), professionalRoutine(21, 'RETIRED')],
      next_cursor: null,
    },
  },
  empty: { status: 200, body: { items: [], next_cursor: null } },
  invalidAccessToken,
  permissionRequired,
  invalidCursor: error(422, 'validation_error', 'Los parámetros no son válidos.', [
    { field: 'query.cursor', issue: 'invalid_cursor' },
  ]),
  upstreamUnavailable,
  upstreamTimeout,
} as const satisfies Record<string, SimulatedResponse>;

export const PUBLISH_ROUTINE_RESPONSES = {
  /** CA4: nace `PUBLISHED` en versión 1 con los alérgenos confirmados por el servicio. */
  published: { status: 201, body: professionalRoutine(0) },
  invalidAccessToken,
  permissionRequired,
  idempotencyKeyReused: error(
    409,
    'idempotency_key_reused',
    'La clave de idempotencia ya se usó con otra solicitud.',
  ),
  /** CA4: validación por campo y por alimento; nada se publica. */
  validationError: error(422, 'validation_error', 'La rutina no es válida.', [
    { field: 'body.title', issue: 'invalid_length' },
    { field: 'body.contains_allergens', issue: 'duplicate_value' },
    { field: 'body.daily_meals.0.items.1.food_code', issue: 'unknown_value' },
    { field: 'body.daily_meals.1.items.0.food_code', issue: 'conflicts_with_restriction' },
    { field: 'body.daily_meals.1.items.0.portions', issue: 'less_than_equal' },
  ]),
  upstreamUnavailable,
  upstreamTimeout,
} as const satisfies Record<string, SimulatedResponse>;

export const RETIRE_ROUTINE_RESPONSES = {
  /** CA4: `RETIRED` en la versión siguiente; la rutina se conserva. */
  retired: { status: 200, body: professionalRoutine(0, 'RETIRED') },
  invalidAccessToken,
  permissionRequired,
  /** Una rutina ajena no puede retirarse. */
  templateNotFound: error(404, 'template_not_found', 'La rutina no existe.'),
  /** La rutina cambió: la versión vigente es la 2. */
  versionConflict: error(409, 'version_conflict', 'La rutina cambió.', [
    { field: 'expected_version', issue: '2' },
  ]),
  validationError: error(422, 'validation_error', 'La solicitud no es válida.', [
    { field: 'body.expected_version', issue: 'missing' },
  ]),
  upstreamUnavailable,
  upstreamTimeout,
} as const satisfies Record<string, SimulatedResponse>;

export const SIMULATED_ROUTINES_CORRELATION_ID = CORRELATION_ID;
