/**
 * Simulador de HU019 derivado del contrato bff-web 0.16.0
 * (`src/app/core/api/contracts/bff-web.openapi.json`) y de ADR-027:
 * `GET /v1/me/services`, `GET /v1/me/services/{service_id}` y
 * `POST /v1/services/{service_id}/publish`. Lo usan las pruebas unitarias y
 * Playwright; `publish-service.contract.spec.ts` valida cada respuesta contra el
 * esquema de su operación. Datos sintéticos.
 *
 * Archivo sin dependencias de Angular para poder importarlo desde Playwright.
 */
import { SIMULATED_SERVICE_ID, SIMULATED_SERVICE_PROVIDER_ID } from './create-service.fixtures';
import { SimulatedResponse } from './register-user.fixtures';

export const MY_SERVICES_PATH = '/v1/me/services';
export const SIMULATED_PUBLISH_SERVICE_ID = SIMULATED_SERVICE_ID;
const CORRELATION_ID = '7c9e1a3c-5e7a-4c9e-8a1c-3e5a7c9e1a4d';
const DAY_MS = 86_400_000;

type Status = 'DRAFT' | 'PUBLISHED';

function iso(epochMs: number): string {
  return new Date(epochMs).toISOString().replace('.000Z', 'Z');
}

/**
 * Servicio propio sintético `index` del profesional (0 = el de ADR-027). Tiene un
 * intervalo futuro (marzo de 2027) salvo que `withAvailability` sea `false`.
 */
export function ownService(index: number, status: Status = 'DRAFT', withAvailability = true) {
  const starts = Date.UTC(2027, 2, 1, 14) + index * DAY_MS;
  const published = status === 'PUBLISHED';
  return {
    service_id:
      index === 0
        ? SIMULATED_PUBLISH_SERVICE_ID
        : `5b7d9f1a-3c5e-4b7d-9f1a-${String(index).padStart(12, '0')}`,
    provider_id: SIMULATED_SERVICE_PROVIDER_ID,
    name: index === 0 ? 'Valoración deportiva inicial' : `Servicio sintético ${index + 1}`,
    description: 'Valoración presencial para orientar el plan deportivo.',
    category: 'SPORTS_MEDICINE' as const,
    modality: 'IN_PERSON' as const,
    price: { amount: '120000.00', currency: 'COP' as const, billing_unit: 'SESSION' as const },
    availability: withAvailability
      ? [
          {
            starts_at: iso(starts),
            ends_at: iso(starts + 3_600_000),
            time_zone: 'America/Bogota',
            capacity: 1,
          },
        ]
      : [],
    status,
    version: published ? 2 : 1,
    created_at: '2026-10-21T15:00:00Z',
    updated_at: published ? '2026-10-22T15:00:00Z' : '2026-10-21T15:00:00Z',
    published_at: published ? '2026-10-22T15:00:00Z' : null,
  };
}

export function ownServices(count: number, status: Status = 'DRAFT', from = 0) {
  return Array.from({ length: count }, (_, index) => ownService(from + index, status));
}

/** Respuesta `200` de publicar: `PUBLISHED`, versión + 1 y `published_at` (ADR-027). */
export function publishedService(service: ReturnType<typeof ownService>) {
  return {
    service_id: service.service_id,
    provider_id: service.provider_id,
    status: 'PUBLISHED' as const,
    version: service.version + 1,
    published_at: '2026-10-22T15:00:00Z',
    updated_at: '2026-10-22T15:00:00Z',
  };
}

function error(
  status: number,
  code: string,
  message: string,
  details: readonly { field: string | null; issue: string }[] = [],
) {
  return { status, body: { code, message, correlation_id: CORRELATION_ID, details } } as const;
}

const invalidAccessToken = error(401, 'invalid_access_token', 'La sesión no es válida.');
const permissionRequired = error(403, 'permission_required', 'No tiene permiso.');
const serviceNotFound = error(404, 'service_not_found', 'El servicio no existe.');
const upstreamUnavailable = error(503, 'upstream_unavailable', 'El servicio no está disponible.');
const upstreamTimeout = error(504, 'upstream_timeout', 'El servicio tardó demasiado en responder.');

export const MY_SERVICES_RESPONSES = {
  empty: { status: 200, body: { items: [], next_cursor: null } },
  firstPage: {
    status: 200,
    body: { items: ownServices(2), next_cursor: 'cursor-sintetico-servicios-2' },
  },
  lastPage: { status: 200, body: { items: ownServices(1, 'DRAFT', 2), next_cursor: null } },
  published: {
    status: 200,
    body: { items: ownServices(1, 'PUBLISHED', 5), next_cursor: null },
  },
  invalidAccessToken,
  permissionRequired,
  validationError: error(422, 'validation_error', 'Los parámetros no son válidos.', [
    { field: 'query.status', issue: 'unknown_value' },
  ]),
  upstreamUnavailable,
  upstreamTimeout,
} as const satisfies Record<string, SimulatedResponse>;

export const MY_SERVICE_RESPONSES = {
  draft: { status: 200, body: ownService(0) },
  draftWithoutAvailability: { status: 200, body: ownService(3, 'DRAFT', false) },
  published: { status: 200, body: ownService(5, 'PUBLISHED') },
  invalidAccessToken,
  permissionRequired,
  serviceNotFound,
  upstreamUnavailable,
  upstreamTimeout,
} as const satisfies Record<string, SimulatedResponse>;

export const PUBLISH_SERVICE_RESPONSES = {
  /** CA1: `DRAFT` → `PUBLISHED`, versión + 1 y `published_at`. */
  published: { status: 200, body: publishedService(ownService(0)) },
  invalidAccessToken,
  permissionRequired,
  /** CA3: inexistente o de otro profesional. */
  serviceNotFound,
  idempotencyKeyReused: error(
    409,
    'idempotency_key_reused',
    'La clave ya se usó con otro servicio.',
  ),
  /** CA2: ejemplo de ADR-027, sin intervalos futuros. */
  availabilityRequired: error(
    422,
    'validation_error',
    'El servicio no cumple los requisitos de publicación.',
    [{ field: 'availability', issue: 'required' }],
  ),
  /** CA2: varias reglas de ADR-027 incumplidas sobre la oferta guardada. */
  requirementsMissing: error(
    422,
    'validation_error',
    'El servicio no cumple los requisitos de publicación.',
    [
      { field: 'description', issue: 'invalid_length' },
      { field: 'price.amount', issue: 'out_of_range' },
      { field: 'availability', issue: 'required' },
    ],
  ),
  upstreamUnavailable,
  upstreamTimeout,
} as const satisfies Record<string, SimulatedResponse>;

export const SIMULATED_PUBLISH_SERVICE_CORRELATION_ID = CORRELATION_ID;
