/**
 * Simulador de HU026 derivado del contrato bff-web 0.23.0
 * (`src/app/core/api/contracts/bff-web.openapi.json`) y de ADR-041:
 * `POST /v1/routes`, `POST /v1/routes/{route_id}/retire` y `GET /v1/me/routes`.
 * Los motivos de `422` son los que agrega el servicio (`invalid_length`,
 * `out_of_range`, `unknown_value`), con el prefijo `body.`. Lo usan las pruebas
 * unitarias y Playwright; `routes.contract.spec.ts` valida cada respuesta contra
 * el esquema de su operación. Datos sintéticos.
 *
 * Archivo sin dependencias de Angular para poder importarlo desde Playwright.
 */
import { SimulatedResponse } from './register-user.fixtures';

export const ROUTES_PATH = '/v1/routes';
export const RETIRE_ROUTE_PATH = '/v1/routes/{route_id}/retire';
export const MY_ROUTES_PATH = '/v1/me/routes';
export const SIMULATED_ROUTES_ORGANIZER_ID = '3c5e7a9b-1d3f-4a5c-9e7b-1d3f5a7c9e1b';
const CORRELATION_ID = '9a1c3e5b-7d9f-4b1d-8f3a-5c7e9b1d3f5a';
const MINUTE_MS = 60_000;

type Status = 'PUBLISHED' | 'RETIRED';

function iso(epochMs: number): string {
  return new Date(epochMs).toISOString().replace('.000Z', 'Z');
}

/** Solicitud válida de ADR-041: vuelta al parque con dos puntos intermedios. */
export const VALID_PUBLISH_ROUTE_REQUEST = {
  name: 'Vuelta al Parque Simón Bolívar',
  description: 'Recorrido plano alrededor del lago, apto para fondo suave.',
  sport: 'running',
  distance_km: '12.5',
  difficulty: 'MODERATE',
  city: 'Bogotá',
  country_code: 'CO',
  start_point: { lat: 4.6584, lng: -74.0937 },
  waypoints: [
    { lat: 4.6601, lng: -74.0902 },
    { lat: 4.6572, lng: -74.0961 },
  ],
} as const;

/**
 * Ruta sintética `index` del organizador. El orden del contrato es `created_at`
 * descendente: un índice mayor es más antiguo.
 */
export function organizerRoute(index: number, status: Status = 'PUBLISHED') {
  const created = Date.UTC(2026, 9, 24, 15) - index * 30 * MINUTE_MS;
  const retired = status === 'RETIRED';
  const base =
    index === 0
      ? VALID_PUBLISH_ROUTE_REQUEST
      : {
          name: `Ruta sintética ${index + 1}`,
          description: null,
          sport: index % 2 === 0 ? ('cycling' as const) : ('running' as const),
          distance_km: `${5 + index}.0`,
          difficulty: 'LOW' as const,
          city: 'Medellín',
          country_code: 'CO',
          start_point: { lat: 6.2442, lng: -75.5812 },
          waypoints: [],
        };
  return {
    route_id: `5b7d9f1a-3c5e-4a7b-9d1f-${String(index + 1).padStart(12, '0')}`,
    organizer_id: SIMULATED_ROUTES_ORGANIZER_ID,
    ...base,
    waypoints: [...base.waypoints],
    source: 'ORGANIZER' as const,
    status,
    version: retired ? 2 : 1,
    created_at: iso(created),
    updated_at: iso(retired ? created + 10 * MINUTE_MS : created),
    published_at: iso(created),
    retired_at: retired ? iso(created + 10 * MINUTE_MS) : null,
  };
}

/** Las rutas `[from, from + count)` en el orden del contrato. */
export function organizerRoutes(count: number, from = 0) {
  return Array.from({ length: count }, (_, index) => organizerRoute(from + index));
}

export const ROUTES_NEXT_CURSOR = 'cursor-sintetico-rutas-2';

function error(
  status: number,
  code: string,
  message: string,
  details: readonly { field: string | null; issue: string }[] = [],
) {
  return { status, body: { code, message, correlation_id: CORRELATION_ID, details } } as const;
}

const invalidAccessToken = error(401, 'invalid_access_token', 'La sesión no es válida.');
const permissionRequired = error(403, 'permission_required', 'Solo el organizador publica rutas.');
const upstreamUnavailable = error(503, 'upstream_unavailable', 'El servicio no está disponible.');
const upstreamTimeout = error(504, 'upstream_timeout', 'El servicio tardó demasiado en responder.');

export const MY_ROUTES_RESPONSES = {
  firstPage: { status: 200, body: { items: organizerRoutes(20), next_cursor: ROUTES_NEXT_CURSOR } },
  lastPage: {
    status: 200,
    body: { items: [organizerRoute(20), organizerRoute(21, 'RETIRED')], next_cursor: null },
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

export const PUBLISH_ROUTE_RESPONSES = {
  /** CA1: nace `PUBLISHED` en versión 1. */
  published: { status: 201, body: organizerRoute(0) },
  invalidAccessToken,
  permissionRequired,
  idempotencyKeyReused: error(
    409,
    'idempotency_key_reused',
    'La clave de idempotencia ya se usó con otra solicitud.',
  ),
  /** CA2: distancia fuera de rango, coordenada inválida y país desconocido; nada se publica. */
  validationError: error(422, 'validation_error', 'La ruta no es válida.', [
    { field: 'body.distance_km', issue: 'out_of_range' },
    { field: 'body.start_point.lat', issue: 'out_of_range' },
    { field: 'body.country_code', issue: 'unknown_value' },
    { field: 'body.waypoints[1].lng', issue: 'out_of_range' },
  ]),
  upstreamUnavailable,
  upstreamTimeout,
} as const satisfies Record<string, SimulatedResponse>;

export const RETIRE_ROUTE_RESPONSES = {
  /** CA4: `RETIRED` en la versión siguiente; la ruta se conserva. */
  retired: { status: 200, body: organizerRoute(0, 'RETIRED') },
  invalidAccessToken,
  permissionRequired,
  /** CA4: una ruta ajena no puede retirarse. */
  routeNotFound: error(404, 'route_not_found', 'La ruta no existe.'),
  /** La ruta cambió: la versión vigente es la 2. */
  versionConflict: error(409, 'version_conflict', 'La ruta cambió.', [
    { field: 'expected_version', issue: '2' },
  ]),
  validationError: error(422, 'validation_error', 'La solicitud no es válida.', [
    { field: 'body.expected_version', issue: 'required' },
  ]),
  upstreamUnavailable,
  upstreamTimeout,
} as const satisfies Record<string, SimulatedResponse>;

export const SIMULATED_ROUTES_CORRELATION_ID = CORRELATION_ID;
