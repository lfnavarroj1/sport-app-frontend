/**
 * Simulador de las consultas de HU012 derivado del contrato bff-web 0.33.0
 * (`src/app/core/api/contracts/bff-web.openapi.json`, ADR-037):
 * `GET /v1/me/health-reports` y `GET /v1/athletes/{athlete_id}/health-reports`.
 * Lo usan las pruebas unitarias y Playwright; `health-reports.contract.spec.ts`
 * valida cada respuesta contra el esquema del contrato. Datos sintéticos.
 *
 * Archivo sin dependencias de Angular para poder importarlo desde Playwright.
 */
import { SimulatedResponse } from './register-user.fixtures';
import { SIMULATED_HISTORY_ATHLETE_ID } from './training-history.fixtures';

export const MY_HEALTH_REPORTS_PATH = '/v1/me/health-reports';
export const SIMULATED_HEALTH_ATHLETE_ID = SIMULATED_HISTORY_ATHLETE_ID;

const CORRELATION_ID = '3d5f7a9c-1e3b-4d5f-8a7c-9e1b3d5f7a9c';
const TYPES = ['DISCOMFORT', 'INJURY', 'INCAPACITY'] as const;
const SEVERITIES = ['LOW', 'MODERATE', 'HIGH'] as const;
const AREAS = ['KNEE', 'BACK', 'ANKLE_FOOT', 'SHOULDER'] as const;

/** Reporte sintético `index` (0 = el más reciente). */
export function healthReport(index: number) {
  return {
    report_id: `9e1b3d5f-7a9c-4e1b-9d5f-${String(index).padStart(12, '0')}`,
    type: TYPES[index % TYPES.length],
    body_area: AREAS[index % AREAS.length],
    severity: SEVERITIES[index % SEVERITIES.length],
    occurred_at: new Date(Date.UTC(2026, 9, 20, 14, 30) - index * 30 * 3600 * 1000)
      .toISOString()
      .replace('.000Z', 'Z'),
    expected_recovery_days: index % 2 === 0 ? 3 + index : null,
    status: 'OPEN' as const,
    session_id:
      index % 3 === 0 ? `5a7c9e1b-3d5f-4a7c-9e1b-${String(index).padStart(12, '0')}` : null,
  };
}

/** Los primeros `count` reportes en el orden del contrato (`occurred_at` desc). */
export function healthReports(count: number) {
  return Array.from({ length: count }, (_, index) => healthReport(index));
}

function error(status: number, code: string, message: string) {
  return {
    status,
    body: { code, message, correlation_id: CORRELATION_ID, details: [] },
  } as const;
}

export const HEALTH_REPORTS_RESPONSES = {
  /** CA4: sin reportes, colección vacía explícita. */
  empty: { status: 200, body: { items: [], next_cursor: null } },
  firstPage: {
    status: 200,
    body: { items: healthReports(3), next_cursor: 'cursor-sintetico-salud-2' },
  },
  lastPage: {
    status: 200,
    body: { items: [healthReport(3), healthReport(4)], next_cursor: null },
  },
  invalidAccessToken: error(401, 'invalid_access_token', 'La sesión no es válida.'),
  permissionRequired: error(403, 'permission_required', 'No tiene permiso.'),
  athleteAuthorizationRequired: error(
    403,
    'athlete_authorization_required',
    'El deportista no ha autorizado al profesional.',
  ),
  validationError: error(422, 'validation_error', 'El periodo o el cursor no son válidos.'),
  upstreamUnavailable: error(503, 'upstream_unavailable', 'El servicio no está disponible.'),
  upstreamTimeout: error(504, 'upstream_timeout', 'El servicio tardó demasiado en responder.'),
} as const satisfies Record<string, SimulatedResponse>;

export const SIMULATED_HEALTH_CORRELATION_ID = CORRELATION_ID;
