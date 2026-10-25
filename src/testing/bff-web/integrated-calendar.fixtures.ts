/**
 * Simulador de HU018 derivado del contrato bff-web 0.30.0
 * (`src/app/core/api/contracts/bff-web.openapi.json`; la operación es la de
 * 0.29.0, sin cambios) y de ADR-039: `GET /v1/me/integrated-calendar`. Una
 * respuesta por actor en marzo de 2027 (zona de Bogotá), más el resultado parcial,
 * el truncado, el vacío y los errores declarados. Lo usan las pruebas unitarias y
 * Playwright; `integrated-calendar.contract.spec.ts` valida cada respuesta contra
 * el esquema de la operación. Datos sintéticos.
 *
 * Archivo sin dependencias de Angular para poder importarlo desde Playwright.
 */
import { SimulatedResponse } from './register-user.fixtures';

export const INTEGRATED_CALENDAR_PATH = '/v1/me/integrated-calendar';
const CORRELATION_ID = '3b8d2f6a-9c1e-4d7b-a5f3-2e8c6a4d1b9f';

/** Marzo de 2027 en la zona de Bogotá (UTC−5), como lo consulta la vista de mes. */
export const MARCH_2027 = { from: '2027-03-01T05:00:00Z', to: '2027-04-01T05:00:00Z' } as const;
const EVALUATED_AT = '2027-02-20T15:00:00Z';

const IDS = {
  ownDraft: '6f1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a01',
  ownPublished: '6f1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a02',
  publishedHalfMarathon: '6f1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a03',
  registration: '7a2b3c4d-5e6f-4a71-9b8c-0d1e2f3a4b01',
  plan: '8b3c4d5e-6f7a-4b82-8c9d-1e2f3a4b5c01',
  session: '8b3c4d5e-6f7a-4b82-8c9d-1e2f3a4b5c02',
  serviceAssessment: '9c4d5e6f-7a8b-4c93-9dae-2f3a4b5c6d01',
  serviceNutrition: '9c4d5e6f-7a8b-4c93-9dae-2f3a4b5c6d02',
  association: 'ad5e6f7a-8b9c-4da4-8ebf-3a4b5c6d7e01',
} as const;

const BOGOTA_PARK = { name: 'Parque Simón Bolívar', city: 'Bogotá', country_code: 'CO' };
const MADRID_PARK = { name: 'Parque del Retiro', city: 'Madrid', country_code: 'ES' };

/** Borrador propio del organizador: 7 de marzo, 06:00–10:00 en Bogotá. */
export const OWN_DRAFT_ITEM = {
  item_id: `OWN_EVENT:${IDS.ownDraft}`,
  occurs_on: '2027-03-07',
  title: 'Media maratón de Bogotá',
  starts_at: '2027-03-07T11:00:00Z',
  ends_at: '2027-03-07T15:00:00Z',
  time_zone: 'America/Bogota',
  source: 'OWN_EVENT' as const,
  status: 'DRAFT' as const,
  sport: 'Running',
  location: BOGOTA_PARK,
  reference: { event_id: IDS.ownDraft },
};

/**
 * Evento propio publicado en Madrid: empieza el 20 de marzo a las 00:30 en su
 * zona (`occurs_on`), que en Bogotá es el 19 de marzo a las 18:30 (CA3).
 */
export const OWN_PUBLISHED_ITEM = {
  item_id: `OWN_EVENT:${IDS.ownPublished}`,
  occurs_on: '2027-03-20',
  title: 'Carrera de medianoche de Madrid',
  starts_at: '2027-03-19T23:30:00Z',
  ends_at: '2027-03-20T01:30:00Z',
  time_zone: 'Europe/Madrid',
  source: 'OWN_EVENT' as const,
  status: 'PUBLISHED' as const,
  sport: 'Running',
  location: MADRID_PARK,
  reference: { event_id: IDS.ownPublished },
};

/** Evento publicado (de cualquier organizador) del 7 de marzo. */
export const PUBLISHED_EVENT_ITEM = {
  item_id: `EVENT_PUBLISHED:${IDS.publishedHalfMarathon}`,
  occurs_on: '2027-03-07',
  title: 'Gran Fondo Bogotá',
  starts_at: '2027-03-07T12:00:00Z',
  ends_at: '2027-03-07T17:00:00Z',
  time_zone: 'America/Bogota',
  source: 'EVENT_PUBLISHED' as const,
  status: 'PUBLISHED' as const,
  sport: 'Cycling',
  location: BOGOTA_PARK,
  reference: { event_id: IDS.publishedHalfMarathon },
};

/** Inscripción del deportista al evento publicado (HU041). */
export const REGISTRATION_ITEM = {
  item_id: `EVENT_REGISTRATION:${IDS.registration}`,
  occurs_on: '2027-03-07',
  title: 'Gran Fondo Bogotá',
  starts_at: '2027-03-07T12:00:00Z',
  ends_at: '2027-03-07T17:00:00Z',
  time_zone: 'America/Bogota',
  source: 'EVENT_REGISTRATION' as const,
  status: 'REGISTERED' as const,
  location: BOGOTA_PARK,
  reference: { event_id: IDS.publishedHalfMarathon, registration_id: IDS.registration },
};

/** Sesión de un plan asignado: una fecha sin hora (`scheduled_date`). */
export const TRAINING_SESSION_ITEM = {
  item_id: `TRAINING_PLAN_SESSION:${IDS.session}`,
  source: 'TRAINING_PLAN_SESSION' as const,
  status: 'ASSIGNED' as const,
  occurs_on: '2027-03-03',
  title: 'Rodaje suave',
  starts_at: null,
  ends_at: null,
  time_zone: null,
  sport: 'running',
  duration_minutes: 45,
  rpe: 4,
  reference: { plan_id: IDS.plan, session_id: IDS.session },
};

/** Intervalo de un servicio publicado propio: 10 de marzo, 09:00–10:00 en Bogotá. */
export const OWN_SERVICE_PUBLISHED_ITEM = {
  item_id: `OWN_SERVICE_AVAILABILITY:${IDS.serviceAssessment}:2027-03-10T14:00:00Z`,
  occurs_on: '2027-03-10',
  title: 'Valoración deportiva',
  starts_at: '2027-03-10T14:00:00Z',
  ends_at: '2027-03-10T15:00:00Z',
  time_zone: 'America/Bogota',
  source: 'OWN_SERVICE_AVAILABILITY' as const,
  status: 'PUBLISHED' as const,
  category: 'SPORTS_MEDICINE',
  modality: 'IN_PERSON',
  capacity: 1,
  reference: { service_id: IDS.serviceAssessment },
};

/** Intervalo de un servicio propio todavía en borrador: 12 de marzo, 08:00–09:00. */
export const OWN_SERVICE_DRAFT_ITEM = {
  item_id: `OWN_SERVICE_AVAILABILITY:${IDS.serviceNutrition}:2027-03-12T13:00:00Z`,
  occurs_on: '2027-03-12',
  title: 'Asesoría nutricional',
  starts_at: '2027-03-12T13:00:00Z',
  ends_at: '2027-03-12T14:00:00Z',
  time_zone: 'America/Bogota',
  source: 'OWN_SERVICE_AVAILABILITY' as const,
  status: 'DRAFT' as const,
  category: 'NUTRITION',
  modality: 'VIRTUAL',
  capacity: 5,
  reference: { service_id: IDS.serviceNutrition },
};

/** Intervalo de un servicio asociado por el deportista (HU017). */
export const ASSOCIATED_SERVICE_ITEM = {
  item_id: `ASSOCIATED_SERVICE_AVAILABILITY:${IDS.association}:2027-03-10T14:00:00Z`,
  occurs_on: '2027-03-10',
  title: 'Valoración deportiva',
  starts_at: '2027-03-10T14:00:00Z',
  ends_at: '2027-03-10T15:00:00Z',
  time_zone: 'America/Bogota',
  source: 'ASSOCIATED_SERVICE_AVAILABILITY' as const,
  status: 'AVAILABLE' as const,
  category: 'SPORTS_MEDICINE',
  modality: 'IN_PERSON',
  capacity: 1,
  reference: { service_id: IDS.serviceAssessment, association_id: IDS.association },
};

type SourceName =
  | 'OWN_EVENT'
  | 'EVENT_PUBLISHED'
  | 'EVENT_REGISTRATION'
  | 'TRAINING_PLAN_SESSION'
  | 'OWN_SERVICE_AVAILABILITY'
  | 'ASSOCIATED_SERVICE_AVAILABILITY';

/** Fuentes de cada actor según ADR-039, en el orden en que las declara el BFF. */
export const ACTOR_SOURCES: Readonly<Record<string, readonly SourceName[]>> = {
  organizer: ['OWN_EVENT'],
  service_provider: ['OWN_SERVICE_AVAILABILITY', 'EVENT_PUBLISHED'],
  athlete: [
    'EVENT_PUBLISHED',
    'TRAINING_PLAN_SESSION',
    'ASSOCIATED_SERVICE_AVAILABILITY',
    'EVENT_REGISTRATION',
  ],
};

/** Elementos de cada actor en marzo de 2027, en el orden del contrato. */
export const ACTOR_ITEMS: Readonly<Record<string, readonly object[]>> = {
  organizer: [OWN_DRAFT_ITEM, OWN_PUBLISHED_ITEM],
  service_provider: [PUBLISHED_EVENT_ITEM, OWN_SERVICE_PUBLISHED_ITEM, OWN_SERVICE_DRAFT_ITEM],
  athlete: [TRAINING_SESSION_ITEM, PUBLISHED_EVENT_ITEM, REGISTRATION_ITEM, ASSOCIATED_SERVICE_ITEM],
};

/** `sources[]` con todas las fuentes `OK`, salvo las indicadas. */
export function sourcesOf(
  actor: string,
  overrides: Partial<Record<SourceName, { status?: string; truncated?: boolean }>> = {},
) {
  return ACTOR_SOURCES[actor].map((name) => ({
    name,
    status: overrides[name]?.status ?? 'OK',
    truncated: overrides[name]?.truncated ?? false,
  }));
}

/** Respuesta `200` del periodo `period` con `items` y `sources`. */
export function integratedCalendar(
  items: readonly object[],
  sources: readonly object[],
  period: { readonly from: string; readonly to: string } = MARCH_2027,
) {
  return {
    from: period.from,
    to: period.to,
    items: [...items],
    sources: [...sources],
    evaluated_at: EVALUATED_AT,
  };
}

function error(status: number, code: string, message: string, details: object[] = []) {
  return { status, body: { code, message, correlation_id: CORRELATION_ID, details } } as const;
}

export const INTEGRATED_CALENDAR_RESPONSES = {
  organizer: {
    status: 200,
    body: integratedCalendar(ACTOR_ITEMS['organizer'], sourcesOf('organizer')),
  },
  serviceProvider: {
    status: 200,
    body: integratedCalendar(ACTOR_ITEMS['service_provider'], sourcesOf('service_provider')),
  },
  athlete: {
    status: 200,
    body: integratedCalendar(ACTOR_ITEMS['athlete'], sourcesOf('athlete')),
  },
  /** Entrenamientos no responde y Servicios agota su tiempo: solo quedan los eventos (CA5). */
  athletePartial: {
    status: 200,
    body: integratedCalendar(
      [PUBLISHED_EVENT_ITEM, REGISTRATION_ITEM],
      sourcesOf('athlete', {
        TRAINING_PLAN_SESSION: { status: 'UNAVAILABLE' },
        ASSOCIATED_SERVICE_AVAILABILITY: { status: 'TIMEOUT' },
      }),
    ),
  },
  /** Más de 200 eventos publicados en el periodo: la fuente llega truncada (CA6). */
  serviceProviderTruncated: {
    status: 200,
    body: integratedCalendar(
      ACTOR_ITEMS['service_provider'],
      sourcesOf('service_provider', { EVENT_PUBLISHED: { truncated: true } }),
    ),
  },
  organizerEmpty: {
    status: 200,
    body: integratedCalendar([], sourcesOf('organizer')),
  },
  /** Sin elementos y con la única fuente caída: no se afirma que no haya actividades. */
  organizerEmptyUnavailable: {
    status: 200,
    body: integratedCalendar([], sourcesOf('organizer', { OWN_EVENT: { status: 'UNAVAILABLE' } })),
  },
  periodTooLong: error(422, 'validation_error', 'Los datos enviados no son válidos.', [
    { field: 'query.to', issue: 'out_of_range' },
  ]),
  invalidAccessToken: error(401, 'invalid_access_token', 'Inicia sesión de nuevo.'),
  permissionRequired: error(403, 'permission_required', 'No tienes permiso para esta consulta.'),
  capabilityRequired: error(403, 'capability_required', 'Tu plan no incluye esta opción.'),
  upstreamUnavailable: error(503, 'upstream_unavailable', 'El servicio no está disponible.'),
  upstreamTimeout: error(504, 'upstream_timeout', 'El servicio no respondió a tiempo.'),
} as const satisfies Record<string, SimulatedResponse>;
