/**
 * Simulador de `GET /v1/services/availability` derivado del contrato bff-web
 * 0.16.0 (`src/app/core/api/contracts/bff-web.openapi.json`) y de ADR-038. Lo
 * usan las pruebas unitarias y Playwright; `services-availability.contract.spec.ts`
 * valida cada respuesta contra el esquema del contrato. Datos sintéticos.
 *
 * Archivo sin dependencias de Angular para poder importarlo desde Playwright.
 */
import { SimulatedResponse } from './register-user.fixtures';

export const SERVICES_AVAILABILITY_PATH = '/v1/services/availability';
export const SIMULATED_PROVIDER_ID = '9c2e4a6b-8d0f-4a2c-8e4a-6c8e0a2c4e6b';
const CORRELATION_ID = '6a8c0e2a-4c6e-4a8c-8e2a-4c6e8a0c2e4a';

const CATEGORIES = ['COACHING', 'NUTRITION', 'TRANSPORT', 'ACCOMPANIMENT'] as const;
/** Categorías del contrato (`CatalogService.category`), incluida la médica. */
type Category = (typeof CATEGORIES)[number] | 'SPORTS_MEDICINE';
const MODALITIES = ['IN_PERSON', 'VIRTUAL', 'HYBRID'] as const;
const UNITS = ['SESSION', 'HOUR', 'SERVICE', 'DAY'] as const;

/**
 * Servicio publicado sintético `index`, con dos intervalos futuros en UTC. Los
 * nombres siguen el orden del keyset (`name`, `service_id`).
 */
export function catalogService(index: number, category: Category = CATEGORIES[index % 4]) {
  const start = Date.UTC(2026, 10, 3 + (index % 20), 13, 0);
  const utc = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z');
  return {
    service_id: `7b9d1f3a-5c7e-4b9d-8f1a-${String(index).padStart(12, '0')}`,
    provider_id: SIMULATED_PROVIDER_ID,
    name: `Servicio sintético ${String(index).padStart(3, '0')}`,
    description: 'Servicio complementario sintético para pruebas del catálogo.',
    category,
    modality: MODALITIES[index % 3],
    price: {
      amount: `${(index + 1) * 10000}.00`,
      currency: 'COP' as const,
      billing_unit: UNITS[index % 4],
    },
    availability: [
      {
        starts_at: utc(start),
        ends_at: utc(start + 3_600_000),
        time_zone: 'America/Bogota',
        capacity: 5,
      },
      {
        starts_at: utc(start + 2 * 86_400_000),
        ends_at: utc(start + 2 * 86_400_000 + 5_400_000),
        time_zone: 'America/Bogota',
        capacity: 1,
      },
    ],
    available: true,
  };
}

/** Servicio publicado sin intervalos en el periodo (solo con `availability=all`). */
export function unavailableService(index: number) {
  return { ...catalogService(index), availability: [], available: false };
}

function error(status: number, code: string, message: string) {
  return {
    status,
    body: { code, message, correlation_id: CORRELATION_ID, details: [] },
  } as const;
}

export const SERVICES_AVAILABILITY_RESPONSES = {
  /** Deportista `FREE`: sin medicina deportiva y con la categoría declarada restringida. */
  firstPage: {
    status: 200,
    body: {
      items: [catalogService(0), catalogService(1), catalogService(2)],
      next_cursor: 'cursor-sintetico-servicios-2',
      restricted_categories: ['SPORTS_MEDICINE'],
    },
  },
  lastPage: {
    status: 200,
    body: {
      items: [catalogService(3)],
      next_cursor: null,
      restricted_categories: ['SPORTS_MEDICINE'],
    },
  },
  /** Deportista `PREMIUM`: la categoría médica aparece y nada queda restringido. */
  premium: {
    status: 200,
    body: {
      items: [catalogService(0, 'SPORTS_MEDICINE'), catalogService(1)],
      next_cursor: null,
      restricted_categories: [],
    },
  },
  /** CA2 con `availability=all`: un servicio sin espacios marcado `available: false`. */
  withUnavailable: {
    status: 200,
    body: {
      items: [catalogService(0), unavailableService(1)],
      next_cursor: null,
      restricted_categories: ['SPORTS_MEDICINE'],
    },
  },
  empty: {
    status: 200,
    body: { items: [], next_cursor: null, restricted_categories: ['SPORTS_MEDICINE'] },
  },
  invalidAccessToken: error(401, 'invalid_access_token', 'La sesión no es válida.'),
  permissionRequired: error(403, 'permission_required', 'Solo el deportista.'),
  validationError: {
    status: 422,
    body: {
      code: 'validation_error',
      message: 'La solicitud no es válida.',
      correlation_id: CORRELATION_ID,
      details: [{ field: 'query.to', issue: 'out_of_range' }],
    },
  },
  upstreamUnavailable: error(503, 'upstream_unavailable', 'El servicio no está disponible.'),
  upstreamTimeout: error(504, 'upstream_timeout', 'El servicio tardó demasiado en responder.'),
} as const satisfies Record<string, SimulatedResponse>;

export const SIMULATED_SERVICES_CORRELATION_ID = CORRELATION_ID;
