import { ApiError } from '../../../core/api/api-error';
import {
  PublishRouteRequestDto,
  ROUTE_LIMITS,
  RouteDifficultyDto,
  RouteResponseDto,
  RouteSportDto,
  RouteStatusDto,
} from '../../../core/api/bff-web/routes.api';

/**
 * Modelo de pantalla de las rutas del organizador (HU026, ADR-041). Transforma el
 * transporte sin reglas del dominio: la validez de la ruta, la propiedad y la
 * versión las decide el backend.
 */

export type RouteSport = RouteSportDto;
export type RouteDifficulty = RouteDifficultyDto;
export type RouteStatus = RouteStatusDto;

export interface RoutePoint {
  readonly lat: number;
  readonly lng: number;
}

/** Ruta propia confirmada por el backend. */
export interface OrganizerRoute {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly sport: RouteSport;
  /** Kilómetros con un decimal, como el texto del contrato (`"12.5"`). */
  readonly distanceKm: string;
  readonly difficulty: RouteDifficulty;
  readonly city: string;
  readonly countryCode: string;
  readonly startPoint: RoutePoint;
  readonly waypoints: readonly RoutePoint[];
  readonly status: RouteStatus;
  readonly version: number;
  /** Instantes UTC (`Z`). */
  readonly publishedAt: string;
  readonly retiredAt: string | null;
}

/** Una página en el orden del backend (`created_at` y `route_id` descendentes). */
export interface RoutesPage {
  readonly routes: readonly OrganizerRoute[];
  readonly nextCursor: string | null;
}

/** Ruta que captura el organizador, ya normalizada para el contrato. */
export interface RouteDraft {
  readonly name: string;
  readonly description: string | null;
  readonly sport: RouteSport;
  /** Decimal como texto con punto (`"12.5"`). */
  readonly distanceKm: string;
  readonly difficulty: RouteDifficulty;
  readonly city: string;
  readonly countryCode: string;
  readonly startPoint: RoutePoint;
  readonly waypoints: readonly RoutePoint[];
}

/** Regla incumplida (`details[{field, issue}]`), sin el prefijo `body.`. */
export interface RouteViolation {
  readonly field: string;
  readonly issue: string;
}

export type PublishOutcome =
  | { readonly kind: 'published'; readonly route: OrganizerRoute; readonly replayed: boolean }
  | { readonly kind: 'invalid'; readonly violations: readonly RouteViolation[] }
  | { readonly kind: 'failed'; readonly error: ApiError };

export type RetireOutcome =
  | { readonly kind: 'retired'; readonly route: OrganizerRoute }
  /** `409 version_conflict`: `currentVersion` es la vigente, o `null` si no la trae. */
  | { readonly kind: 'conflict'; readonly currentVersion: number | null }
  | { readonly kind: 'failed'; readonly error: ApiError };

export function toOrganizerRoute(dto: RouteResponseDto): OrganizerRoute {
  return {
    id: dto.route_id,
    name: dto.name,
    description: dto.description,
    sport: dto.sport,
    distanceKm: dto.distance_km,
    difficulty: dto.difficulty,
    city: dto.city,
    countryCode: dto.country_code,
    startPoint: { lat: dto.start_point.lat, lng: dto.start_point.lng },
    waypoints: dto.waypoints.map((point) => ({ lat: point.lat, lng: point.lng })),
    status: dto.status,
    version: dto.version,
    publishedAt: dto.published_at,
    retiredAt: dto.retired_at,
  };
}

/** Cuerpo de `POST /v1/routes`: sin `organizer_id` ni campos adicionales. */
export function toPublishRouteRequest(draft: RouteDraft): PublishRouteRequestDto {
  return {
    name: draft.name,
    description: draft.description,
    sport: draft.sport,
    distance_km: draft.distanceKm,
    difficulty: draft.difficulty,
    city: draft.city,
    country_code: draft.countryCode,
    start_point: { lat: draft.startPoint.lat, lng: draft.startPoint.lng },
    waypoints: draft.waypoints.map((point) => ({ lat: point.lat, lng: point.lng })),
  };
}

/** Recorta y acepta la coma decimal de `es`; el valor viaja como cadena. */
export function normalizeDistance(text: string): string {
  return text.trim().replace(',', '.');
}

/**
 * La distancia es un decimal con un decimal como máximo entre 0.1 y 500.0 (la
 * forma que documenta el contrato); se compara en décimas, sin `Number`.
 * Validación de experiencia: la regla autoritativa es del backend.
 */
export function distanceIssue(text: string): 'format' | 'range' | null {
  const match = /^(\d{1,3})(?:\.(\d))?$/.exec(text);
  if (!match) {
    return 'format';
  }
  const tenths = Number(match[1]) * 10 + Number(match[2] ?? '0');
  return tenths < tenthsOf(ROUTE_LIMITS.distanceMin) || tenths > tenthsOf(ROUTE_LIMITS.distanceMax)
    ? 'range'
    : null;
}

/** Décimas de un límite del contrato (`"0.1"` → 1, `"500.0"` → 5000). */
function tenthsOf(value: string): number {
  return Math.round(Number(value) * 10);
}

/** Dónde se marca una regla de `POST /v1/routes` en el formulario. */
export type RouteTarget =
  | {
      readonly kind: 'field';
      readonly control:
        | 'name'
        | 'description'
        | 'sport'
        | 'distanceKm'
        | 'difficulty'
        | 'city'
        | 'countryCode'
        | 'startLat'
        | 'startLng';
    }
  /** Un punto intermedio (`waypoints[i].lat`); `coordinate` es `null` si la regla es del punto. */
  | { readonly kind: 'waypoint'; readonly index: number; readonly coordinate: 'lat' | 'lng' | null }
  /** La lista completa de puntos intermedios. */
  | { readonly kind: 'waypoints' }
  /** Sin control (`Idempotency-Key`, `organizer_id` o sin campo): solo el resumen. */
  | { readonly kind: 'none' };

const FIELD_CONTROLS: Readonly<Record<string, RouteTarget>> = {
  name: { kind: 'field', control: 'name' },
  description: { kind: 'field', control: 'description' },
  sport: { kind: 'field', control: 'sport' },
  distance_km: { kind: 'field', control: 'distanceKm' },
  difficulty: { kind: 'field', control: 'difficulty' },
  city: { kind: 'field', control: 'city' },
  country_code: { kind: 'field', control: 'countryCode' },
  start_point: { kind: 'field', control: 'startLat' },
  'start_point.lat': { kind: 'field', control: 'startLat' },
  'start_point.lng': { kind: 'field', control: 'startLng' },
  waypoints: { kind: 'waypoints' },
};

const WAYPOINT_PATH = /^waypoints\[(\d+)\](?:\.(lat|lng))?$/;

/** Ubica la ruta de `details[].field` (sin `body.`) en el formulario. */
export function routeTarget(field: string): RouteTarget {
  const waypoint = WAYPOINT_PATH.exec(field);
  if (waypoint) {
    return {
      kind: 'waypoint',
      index: Number(waypoint[1]),
      coordinate: (waypoint[2] as 'lat' | 'lng' | undefined) ?? null,
    };
  }
  return Object.hasOwn(FIELD_CONTROLS, field) ? FIELD_CONTROLS[field] : { kind: 'none' };
}

/** Motivos que el cliente sabe explicar; otro motivo usa un texto genérico. */
const KNOWN_ISSUES: readonly string[] = [
  'required',
  'invalid_length',
  'out_of_range',
  'unknown_value',
  'field_not_allowed',
];

export function routeIssueKey(issue: string): string {
  return `training.routes.issues.${KNOWN_ISSUES.includes(issue) ? issue : 'unknown'}`;
}

/** Texto del campo afectado para el resumen («Punto intermedio 2 (longitud)»). */
export function routeFieldText(field: string): {
  readonly key: string;
  readonly params: Readonly<Record<string, unknown>>;
} {
  const target = routeTarget(field);
  switch (target.kind) {
    case 'field':
      return { key: `training.routes.fields.${target.control}`, params: {} };
    case 'waypoint':
      return {
        key: `training.routes.violationFields.waypoint${target.coordinate === null ? '' : target.coordinate === 'lat' ? 'Lat' : 'Lng'}`,
        params: { n: target.index + 1 },
      };
    case 'waypoints':
      return { key: 'training.routes.fields.waypoints', params: {} };
    case 'none':
      return { key: 'training.routes.violationFields.request', params: {} };
  }
}
