/**
 * Simulador de las consultas de HU011 derivado del contrato bff-web 0.15.0
 * (`src/app/core/api/contracts/bff-web.openapi.json`): `GET /v1/training-history`,
 * `GET /v1/athletes/{athlete_id}/training-history` y `GET /v1/me/training-athletes`
 * (CA5). Lo usan las pruebas unitarias y Playwright; `training-history.contract.spec.ts`
 * valida cada respuesta contra el esquema del contrato. Datos sintéticos.
 *
 * Archivo sin dependencias de Angular para poder importarlo desde Playwright.
 */
import { SimulatedResponse } from './register-user.fixtures';
import { SIMULATED_ATHLETE_ID, SIMULATED_PLAN_ID } from './training.fixtures';

export const OWN_TRAINING_HISTORY_PATH = '/v1/training-history';
export const SIMULATED_HISTORY_ATHLETE_ID = SIMULATED_ATHLETE_ID;

const CORRELATION_ID = '8c1e3a5b-7d9f-4b2c-a4e6-0f2b4d6e8a1c';
const SPORTS = ['running', 'cycling', 'swimming'] as const;

/** Sesión terminada sintética `index` (0 = la más reciente). */
export function historyItem(index: number) {
  const ended = Date.UTC(2026, 9, 12, 12) - index * 26 * 3600 * 1000;
  const duration = 1800 + (index % 4) * 900;
  return {
    session_id: `5a7c9e1b-3d5f-4a7c-9e1b-${String(index).padStart(12, '0')}`,
    plan_id: index % 2 === 0 ? SIMULATED_PLAN_ID : null,
    sport: SPORTS[index % SPORTS.length],
    started_at: new Date(ended - duration * 1000).toISOString(),
    ended_at: new Date(ended).toISOString(),
    duration_seconds: duration,
  };
}

/** Las primeras `count` sesiones en el orden del contrato (`ended_at` desc). */
export function historyItems(count: number) {
  return Array.from({ length: count }, (_, index) => historyItem(index));
}

function error(status: number, code: string, message: string) {
  return {
    status,
    body: { code, message, correlation_id: CORRELATION_ID, details: [] },
  } as const;
}

export const TRAINING_HISTORY_RESPONSES = {
  /** CA2: sin historial, colección vacía y filtros disponibles. */
  empty: { status: 200, body: { items: [], next_cursor: null, filters: { sports: [] } } },
  firstPage: {
    status: 200,
    body: {
      items: historyItems(3),
      next_cursor: 'cursor-sintetico-pagina-2',
      filters: { sports: [...SPORTS] },
    },
  },
  lastPage: {
    status: 200,
    body: {
      items: [historyItem(3), historyItem(4)],
      next_cursor: null,
      filters: { sports: [...SPORTS] },
    },
  },
  invalidAccessToken: error(401, 'invalid_access_token', 'La sesión no es válida.'),
  permissionRequired: error(403, 'permission_required', 'No tiene permiso.'),
  athleteAuthorizationRequired: error(
    403,
    'athlete_authorization_required',
    'El deportista no ha autorizado al profesional.',
  ),
  validationError: error(422, 'validation_error', 'Los filtros no son válidos.'),
  upstreamUnavailable: error(503, 'upstream_unavailable', 'El servicio no está disponible.'),
  upstreamTimeout: error(504, 'upstream_timeout', 'El servicio tardó demasiado en responder.'),
} as const satisfies Record<string, SimulatedResponse>;

export const SIMULATED_HISTORY_CORRELATION_ID = CORRELATION_ID;

/** Ruta de `GET /v1/me/training-athletes` (CA5). */
export const TRAINING_ATHLETES_PATH = '/v1/me/training-athletes';

/**
 * Deportista sintético `index` con autorización vigente (0 = la más reciente,
 * orden del contrato: `authorized_at` y `athlete_id` descendentes).
 */
export function trainingAthlete(index: number) {
  return {
    athlete_id:
      index === 0
        ? SIMULATED_HISTORY_ATHLETE_ID
        : `7b9d1f3a-5c7e-4b9d-8f1a-${String(index).padStart(12, '0')}`,
    full_name: `Deportista Sintético ${index + 1}`,
    email: `deportista-${index + 1}@example.com`,
    authorized_at: new Date(Date.UTC(2026, 9, 10, 15) - index * 3600 * 1000).toISOString(),
  };
}

/** Los primeros `count` deportistas en el orden del contrato. */
export function trainingAthletes(count: number) {
  return Array.from({ length: count }, (_, index) => trainingAthlete(index));
}

export const TRAINING_ATHLETES_RESPONSES = {
  /** Ningún deportista ha autorizado al profesional (o todos revocaron). */
  empty: { status: 200, body: { items: [], next_cursor: null } },
  firstPage: {
    status: 200,
    body: { items: trainingAthletes(2), next_cursor: 'cursor-sintetico-deportistas-2' },
  },
  lastPage: {
    status: 200,
    body: { items: [trainingAthlete(2)], next_cursor: null },
  },
  invalidAccessToken: error(401, 'invalid_access_token', 'La sesión no es válida.'),
  permissionRequired: error(403, 'permission_required', 'No tiene permiso.'),
  validationError: error(422, 'validation_error', 'El límite o el cursor no son válidos.'),
  upstreamUnavailable: error(503, 'upstream_unavailable', 'El servicio no está disponible.'),
  upstreamTimeout: error(504, 'upstream_timeout', 'El servicio tardó demasiado en responder.'),
} as const satisfies Record<string, SimulatedResponse>;
