/**
 * Simulador de HU028 derivado del contrato bff-web 0.24.0
 * (`src/app/core/api/contracts/bff-web.openapi.json`) y de ADR-041:
 * `POST /v1/training-plan-templates`, `POST /v1/training-plan-templates/{template_id}/retire`
 * y `GET /v1/me/training-plan-templates`. Los motivos de `422` son los que agrega el
 * servicio (`invalid_length`, `out_of_range`) y los de la validación de forma
 * (`string_too_short`), con el prefijo `body.` y la sesión como `weekly_sessions.N`.
 * Lo usan las pruebas unitarias y Playwright; `training-templates.contract.spec.ts`
 * valida cada respuesta contra el esquema de su operación. Datos sintéticos.
 *
 * Archivo sin dependencias de Angular para poder importarlo desde Playwright.
 */
import { SimulatedResponse } from './register-user.fixtures';

export const TEMPLATES_PATH = '/v1/training-plan-templates';
export const RETIRE_TEMPLATE_PATH = '/v1/training-plan-templates/{template_id}/retire';
export const MY_TEMPLATES_PATH = '/v1/me/training-plan-templates';
export const SIMULATED_TEMPLATES_PROFESSIONAL_ID = '7e9a1c3b-5d7f-4b9a-8c1e-3b5d7f9a1c3e';
const CORRELATION_ID = '2d4f6a8c-1e3b-4d5f-9a7c-2e4b6d8f1a3c';
const MINUTE_MS = 60_000;

type Status = 'PUBLISHED' | 'RETIRED';

function iso(epochMs: number): string {
  return new Date(epochMs).toISOString().replace('.000Z', 'Z');
}

/** Solicitud válida de ADR-041: base aeróbica de 8 semanas con tres sesiones. */
export const VALID_PUBLISH_TEMPLATE_REQUEST = {
  title: 'Base aeróbica para 10K',
  objectives: 'Construir una base aeróbica estable para completar 10 km sin pausas.',
  sport: 'running',
  goal: 'PERFORMANCE',
  level: 'BEGINNER',
  duration_weeks: 8,
  weekly_sessions: [
    { day_of_week: 'MON', description: 'Trote suave continuo.', duration_minutes: 40 },
    { day_of_week: 'WED', description: 'Intervalos de 4 x 5 minutos.', duration_minutes: 45 },
    { day_of_week: 'SAT', description: 'Fondo largo a ritmo cómodo.', duration_minutes: 70 },
  ],
} as const;

/**
 * Plantilla sintética `index` del profesional. El orden del contrato es
 * `created_at` descendente: un índice mayor es más antiguo.
 */
export function professionalTemplate(index: number, status: Status = 'PUBLISHED') {
  const created = Date.UTC(2026, 9, 24, 15) - index * 30 * MINUTE_MS;
  const retired = status === 'RETIRED';
  const base =
    index === 0
      ? VALID_PUBLISH_TEMPLATE_REQUEST
      : {
          title: `Plantilla sintética ${index + 1}`,
          objectives: 'Mantener la condición física general con sesiones cortas.',
          sport: index % 2 === 0 ? ('cycling' as const) : ('strength' as const),
          goal: 'HEALTH' as const,
          level: 'INTERMEDIATE' as const,
          duration_weeks: 4,
          weekly_sessions: [
            { day_of_week: 'TUE' as const, description: 'Sesión general.', duration_minutes: 30 },
          ],
        };
  return {
    template_id: `8c1e3a5b-7d9f-4c1e-9a3b-${String(index + 1).padStart(12, '0')}`,
    professional_id: SIMULATED_TEMPLATES_PROFESSIONAL_ID,
    ...base,
    weekly_sessions: base.weekly_sessions.map((session) => ({ ...session })),
    status,
    version: retired ? 2 : 1,
    created_at: iso(created),
    updated_at: iso(retired ? created + 10 * MINUTE_MS : created),
    published_at: iso(created),
    retired_at: retired ? iso(created + 10 * MINUTE_MS) : null,
  };
}

/** Las plantillas `[from, from + count)` en el orden del contrato. */
export function professionalTemplates(count: number, from = 0) {
  return Array.from({ length: count }, (_, index) => professionalTemplate(from + index));
}

export const TEMPLATES_NEXT_CURSOR = 'cursor-sintetico-plantillas-2';

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
  'Solo el profesional publica plantillas.',
);
const upstreamUnavailable = error(503, 'upstream_unavailable', 'El servicio no está disponible.');
const upstreamTimeout = error(504, 'upstream_timeout', 'El servicio tardó demasiado en responder.');

export const MY_TEMPLATES_RESPONSES = {
  firstPage: {
    status: 200,
    body: { items: professionalTemplates(20), next_cursor: TEMPLATES_NEXT_CURSOR },
  },
  lastPage: {
    status: 200,
    body: {
      items: [professionalTemplate(20), professionalTemplate(21, 'RETIRED')],
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

export const PUBLISH_TEMPLATE_RESPONSES = {
  /** CA4: nace `PUBLISHED` en versión 1. */
  published: { status: 201, body: professionalTemplate(0) },
  invalidAccessToken,
  permissionRequired,
  idempotencyKeyReused: error(
    409,
    'idempotency_key_reused',
    'La clave de idempotencia ya se usó con otra solicitud.',
  ),
  /** CA4: validación por campo y por sesión; nada se publica. */
  validationError: error(422, 'validation_error', 'La plantilla no es válida.', [
    { field: 'body.title', issue: 'invalid_length' },
    { field: 'body.duration_weeks', issue: 'out_of_range' },
    { field: 'body.weekly_sessions.1.duration_minutes', issue: 'out_of_range' },
    { field: 'body.weekly_sessions.2.description', issue: 'string_too_short' },
  ]),
  upstreamUnavailable,
  upstreamTimeout,
} as const satisfies Record<string, SimulatedResponse>;

export const RETIRE_TEMPLATE_RESPONSES = {
  /** CA3: `RETIRED` en la versión siguiente; la plantilla se conserva. */
  retired: { status: 200, body: professionalTemplate(0, 'RETIRED') },
  invalidAccessToken,
  permissionRequired,
  /** CA3: una plantilla ajena no puede retirarse. */
  templateNotFound: error(404, 'template_not_found', 'La plantilla no existe.'),
  /** La plantilla cambió: la versión vigente es la 2. */
  versionConflict: error(409, 'version_conflict', 'La plantilla cambió.', [
    { field: 'expected_version', issue: '2' },
  ]),
  validationError: error(422, 'validation_error', 'La solicitud no es válida.', [
    { field: 'body.expected_version', issue: 'missing' },
  ]),
  upstreamUnavailable,
  upstreamTimeout,
} as const satisfies Record<string, SimulatedResponse>;

export const SIMULATED_TEMPLATES_CORRELATION_ID = CORRELATION_ID;
