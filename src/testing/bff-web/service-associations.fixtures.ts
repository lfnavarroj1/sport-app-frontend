/**
 * Simulador de las asociaciones a servicios médicos deportivos derivado del
 * contrato bff-web 0.25.0 (`src/app/core/api/contracts/bff-web.openapi.json`) y de
 * ADR-038 (HU017). Lo usan las pruebas unitarias y Playwright;
 * `service-associations.contract.spec.ts` valida cada respuesta contra el esquema
 * del contrato. Datos sintéticos.
 *
 * Archivo sin dependencias de Angular para poder importarlo desde Playwright.
 */
import { SimulatedResponse } from './register-user.fixtures';
import { catalogService } from './services-availability.fixtures';

export const SERVICE_ASSOCIATIONS_PATH = '/v1/me/service-associations';
export const SERVICE_ASSOCIATION_PATH = '/v1/me/service-associations/{association_id}';
export const SERVICE_ASSOCIATIONS_NEXT_CURSOR = 'cursor-sintetico-asociaciones-20';
const CORRELATION_ID = '3e5a7c9e-1b3d-4f5a-8c7e-9a1b3d5f7a9c';

export const VALID_ASSOCIATE_SERVICE_REQUEST = {
  service_id: catalogService(0, 'SPORTS_MEDICINE').service_id,
} as const;

/**
 * Asociación sintética `index` con el resumen del servicio médico `index` del
 * catálogo simulado de HU020 (mismo `service_id`). Activa salvo que se indique.
 */
export function serviceAssociation(index: number, status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE') {
  const service = catalogService(index, 'SPORTS_MEDICINE');
  const associatedAt = new Date(Date.UTC(2026, 9, 20, 15, 0) - index * 3_600_000);
  const utc = (date: Date) => date.toISOString().replace('.000Z', 'Z');
  return {
    association_id: `5d7f9b1c-3e5a-4c7e-9a1b-${String(index).padStart(12, '0')}`,
    service_id: service.service_id,
    service: {
      name: service.name,
      category: service.category,
      modality: service.modality,
      fee: service.price,
    },
    status,
    associated_at: utc(associatedAt),
    ended_at: status === 'INACTIVE' ? utc(new Date(associatedAt.getTime() + 86_400_000)) : null,
    version: status === 'INACTIVE' ? 2 : 1,
  };
}

function error(status: number, code: string, message: string, details: unknown[] = []) {
  return { status, body: { code, message, correlation_id: CORRELATION_ID, details } } as const;
}

const COMMON_ERRORS = {
  invalidAccessToken: error(401, 'invalid_access_token', 'La sesión no es válida.'),
  permissionRequired: error(403, 'permission_required', 'Solo el deportista.'),
  capabilityRequired: error(403, 'capability_required', 'Su plan no incluye esta opción.'),
  upstreamUnavailable: error(503, 'upstream_unavailable', 'El servicio no está disponible.'),
  upstreamTimeout: error(504, 'upstream_timeout', 'El servicio tardó demasiado en responder.'),
} as const;

export const ASSOCIATE_SERVICE_RESPONSES = {
  created: { status: 201, body: serviceAssociation(0) },
  ...COMMON_ERRORS,
  serviceNotFound: error(404, 'service_not_found', 'El servicio no existe.'),
  /** CA3: la activa viaja en `details` como `{field: "association_id", issue: <id>}`. */
  associationExists: error(409, 'association_exists', 'Ya existe una asociación activa.', [
    { field: 'association_id', issue: serviceAssociation(0).association_id },
  ]),
  idempotencyKeyReused: error(409, 'idempotency_key_reused', 'La clave ya se usó.'),
  validationError: error(422, 'validation_error', 'La solicitud no es válida.', [
    { field: 'body.service_id', issue: 'invalid_uuid' },
  ]),
} as const satisfies Record<string, SimulatedResponse>;

export const DISSOCIATE_SERVICE_RESPONSES = {
  ...COMMON_ERRORS,
  associationNotFound: error(404, 'association_not_found', 'La asociación no existe.'),
  validationError: error(422, 'validation_error', 'La solicitud no es válida.', [
    { field: 'path.association_id', issue: 'invalid_uuid' },
  ]),
} as const satisfies Record<string, SimulatedResponse>;

export const SERVICE_ASSOCIATIONS_RESPONSES = {
  /** Primera página de 20 activas; hay más. */
  firstPage: {
    status: 200,
    body: {
      items: Array.from({ length: 20 }, (_, index) => serviceAssociation(index)),
      next_cursor: SERVICE_ASSOCIATIONS_NEXT_CURSOR,
    },
  },
  lastPage: {
    status: 200,
    body: { items: [serviceAssociation(20), serviceAssociation(21)], next_cursor: null },
  },
  /** CA5 con `status=ALL`: la desasociada se conserva con `ended_at`. */
  withHistory: {
    status: 200,
    body: { items: [serviceAssociation(0), serviceAssociation(1, 'INACTIVE')], next_cursor: null },
  },
  empty: { status: 200, body: { items: [], next_cursor: null } },
  ...COMMON_ERRORS,
  validationError: error(422, 'validation_error', 'La solicitud no es válida.', [
    { field: 'query.status', issue: 'invalid_value' },
  ]),
} as const satisfies Record<string, SimulatedResponse>;

export const SIMULATED_ASSOCIATIONS_CORRELATION_ID = CORRELATION_ID;
