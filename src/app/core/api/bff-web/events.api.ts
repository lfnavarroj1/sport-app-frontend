import { HttpClient, HttpHeaders, HttpParams, HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { BffWebUrl } from '../bff-web-url';
import { STRICT_CODEC } from './training-history.api';

/**
 * Transporte de las operaciones de eventos del contrato bff-web 0.16.0 (ver
 * `contract.ts`): `POST /v1/events` (operationId `create_v1_events_post`,
 * ADR-028, HU021) y, para HU024 (ADR-033), `GET /v1/me/events`,
 * `GET /v1/events/{event_id}` y `POST /v1/events/{event_id}/publish`; desde 0.17.0,
 * para HU023 (ADR-040), `GET /v1/events` (calendario de publicados) y
 * `GET /v1/me/events/{event_id}/conflicts` (coincidencias); desde 0.22.0, para
 * HU022 (ADR-039), `GET /v1/me/events/{event_id}/registrations` (inscritos). Todas se
 * autentican con el access token; `organizer_id` sale del token y nunca viaja en
 * la solicitud. Estos tipos son del transporte: la interfaz los transforma antes
 * de usarlos.
 */

/** Esquema `EventLocation`. */
export interface EventLocationDto {
  readonly name: string;
  readonly address: string;
  readonly city: string;
  /** ISO 3166-1 alfa-2 en mayúsculas. */
  readonly country_code: string;
}

/** Esquema `CreateEventRequest`: exactamente los campos de ADR-028. */
export interface CreateEventRequestDto {
  readonly name: string;
  readonly description: string;
  readonly discipline: string;
  readonly location: EventLocationDto;
  /** Instante ISO 8601 con desfase explícito, coherente con `time_zone`. */
  readonly starts_at: string;
  /** Zona IANA declarada. */
  readonly time_zone: string;
  readonly duration_minutes: number;
  readonly capacity: number;
}

/** Esquema `EventResponse`: borrador confirmado, instantes en UTC (`Z`). */
export interface EventResponseDto {
  readonly event_id: string;
  readonly organizer_id: string;
  readonly name: string;
  readonly description: string;
  readonly discipline: string;
  readonly location: EventLocationDto;
  readonly starts_at: string;
  readonly ends_at: string;
  readonly time_zone: string;
  readonly duration_minutes: number;
  readonly capacity: number;
  readonly status: 'DRAFT';
  readonly version: number;
  readonly created_at: string;
  readonly updated_at: string;
}

/** Límites de `CreateEventRequest` y `EventLocation` en el contrato (ADR-028). */
export const CREATE_EVENT_LIMITS = {
  nameMin: 3,
  nameMax: 120,
  descriptionMin: 20,
  descriptionMax: 2000,
  disciplineMin: 2,
  disciplineMax: 80,
  locationNameMin: 3,
  locationNameMax: 120,
  addressMin: 5,
  addressMax: 200,
  cityMin: 2,
  cityMax: 80,
  durationMin: 15,
  durationMax: 1440,
  capacityMin: 1,
  capacityMax: 100000,
} as const;

/** Patrón de `country_code` en el contrato. */
export const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;

/** Códigos de error que el contrato declara para `POST /v1/events`. */
export const CREATE_EVENT_ERROR_CODES = {
  invalidAccessToken: 'invalid_access_token',
  permissionRequired: 'permission_required',
  idempotencyKeyReused: 'idempotency_key_reused',
  validationError: 'validation_error',
  upstreamUnavailable: 'upstream_unavailable',
  upstreamTimeout: 'upstream_timeout',
} as const;

/**
 * Catálogo estable de `details[].issue` de `validation_error` para HU021
 * (ADR-028, decisión 9). El OpenAPI lo referencia como «ADR-028».
 */
export const CREATE_EVENT_ISSUES = [
  'required',
  'field_not_allowed',
  'invalid_length',
  'unknown_value',
  'not_in_future',
  'out_of_range',
  'time_zone_unknown',
  'time_zone_offset_mismatch',
] as const;

/** Cabecera de respuesta que marca el resultado de un reintento idempotente. */
export const EVENT_IDEMPOTENT_REPLAYED_HEADER = 'Idempotent-Replayed';

/** Enumeración `status` del agregado (ADR-033). */
export type EventStatusDto = 'DRAFT' | 'PUBLISHED';

/**
 * Esquema `EventAggregateResponse`: agregado completo de ADR-028 con estado,
 * versión y `published_at` (`null` en borrador). Lo devuelven
 * `GET /v1/me/events` y `POST /v1/events/{event_id}/publish`.
 */
export interface EventAggregateResponseDto {
  readonly event_id: string;
  readonly organizer_id: string;
  readonly name: string;
  readonly description: string;
  readonly discipline: string;
  readonly location: EventLocationDto;
  readonly starts_at: string;
  readonly ends_at: string;
  readonly time_zone: string;
  readonly duration_minutes: number;
  readonly capacity: number;
  readonly status: EventStatusDto;
  readonly version: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly published_at: string | null;
}

/** Esquema `MyEventsResponse`: orden `starts_at` y `event_id` ascendentes. */
export interface MyEventsResponseDto {
  readonly items: readonly EventAggregateResponseDto[];
  readonly next_cursor: string | null;
}

/** Parámetros de `GET /v1/me/events`; los ausentes no se envían. */
export interface MyEventsQueryDto {
  /** Sin él, el BFF devuelve `DRAFT` y `PUBLISHED`. */
  readonly status?: EventStatusDto | null;
  /** 1–100; el BFF usa 20 si no se envía. */
  readonly limit?: number | null;
  /** Cursor opaco de `next_cursor`; la web nunca lo interpreta. */
  readonly cursor?: string | null;
}

/** Esquema `EventDetailLocation`: el detalle no incluye la dirección. */
export interface EventDetailLocationDto {
  readonly name: string;
  readonly city: string;
  readonly country_code: string;
}

/** Esquema `EventFee` (HU025). */
export interface EventFeeDto {
  /** Cadena decimal con dos decimales. */
  readonly amount: string;
  readonly currency: string;
  readonly billing_unit: string;
}

/** Esquema `EventDetailResponse` de `GET /v1/events/{event_id}` en el canal web. */
export interface EventDetailResponseDto {
  readonly event_id: string;
  readonly name: string;
  readonly description: string;
  readonly discipline: string;
  readonly location: EventDetailLocationDto;
  readonly starts_at: string;
  readonly ends_at: string;
  readonly time_zone: string;
  readonly capacity: number;
  /** `DRAFT` solo lo recibe el organizador propietario. */
  readonly status: EventStatusDto;
  readonly version: number;
  /** `null` hasta HU025. */
  readonly fee: EventFeeDto | null;
}

/** Límites del parámetro `limit` de `GET /v1/me/events`. */
export const MY_EVENTS_LIMIT = { min: 1, max: 100, default: 20 } as const;

/** Códigos de error que el contrato declara para `GET /v1/me/events`. */
export const MY_EVENTS_ERROR_CODES = {
  invalidAccessToken: 'invalid_access_token',
  permissionRequired: 'permission_required',
  validationError: 'validation_error',
  upstreamUnavailable: 'upstream_unavailable',
  upstreamTimeout: 'upstream_timeout',
} as const;

/** Códigos de error que el contrato declara para `GET /v1/events/{event_id}`. */
export const EVENT_DETAIL_ERROR_CODES = {
  invalidAccessToken: 'invalid_access_token',
  permissionRequired: 'permission_required',
  eventNotFound: 'event_not_found',
  upstreamUnavailable: 'upstream_unavailable',
  upstreamTimeout: 'upstream_timeout',
} as const;

/** Códigos de error que el contrato declara para `POST /v1/events/{event_id}/publish`. */
export const PUBLISH_EVENT_ERROR_CODES = {
  invalidAccessToken: 'invalid_access_token',
  permissionRequired: 'permission_required',
  eventNotFound: 'event_not_found',
  idempotencyKeyReused: 'idempotency_key_reused',
  validationError: 'validation_error',
  upstreamUnavailable: 'upstream_unavailable',
  upstreamTimeout: 'upstream_timeout',
} as const;

/** Esquema `PublishedEventLocation`: sin dirección. */
export interface PublishedEventLocationDto {
  readonly name: string;
  readonly city: string;
  readonly country_code: string;
}

/** Esquema `PublishedEventItem` de `GET /v1/events`: sin `organizer_id` (HU023 CA1). */
export interface PublishedEventItemDto {
  readonly event_id: string;
  readonly name: string;
  readonly discipline: string;
  readonly location: PublishedEventLocationDto;
  readonly starts_at: string;
  readonly ends_at: string;
  readonly time_zone: string;
  readonly status: 'PUBLISHED';
  readonly version: number;
}

/** Esquema `PublishedEventsResponse`: orden `starts_at` y `event_id` ascendentes. */
export interface PublishedEventsResponseDto {
  readonly items: readonly PublishedEventItemDto[];
  readonly next_cursor: string | null;
}

/** Parámetros de `GET /v1/events`; los opcionales ausentes no se envían. */
export interface PublishedEventsQueryDto {
  /** Instante ISO 8601 con desfase UTC explícito. */
  readonly from: string;
  readonly to: string;
  readonly discipline?: string | null;
  readonly city?: string | null;
  /** 1–200; el BFF usa 200 si no se envía. */
  readonly limit?: number | null;
  /** Cursor opaco de `next_cursor`, reenviado con los mismos filtros. */
  readonly cursor?: string | null;
}

/** Límites del parámetro `limit` de `GET /v1/events`. */
export const PUBLISHED_EVENTS_LIMIT = { min: 1, max: 200, default: 200 } as const;

/** Motivos de una coincidencia, en el orden del contrato. */
export const CONFLICT_REASONS = ['SAME_DISCIPLINE', 'SAME_CITY'] as const;
export type ConflictReasonDto = (typeof CONFLICT_REASONS)[number];

/** Esquema `EventConflict`. */
export interface EventConflictDto {
  readonly event_id: string;
  readonly name: string;
  readonly discipline: string;
  readonly city: string;
  readonly starts_at: string;
  readonly ends_at: string;
  readonly time_zone: string;
  readonly reasons: readonly ConflictReasonDto[];
}

/** Esquema `EventConflictsResponse`. */
export interface EventConflictsResponseDto {
  readonly conflicts: readonly EventConflictDto[];
  readonly evaluated_at: string;
}

/** Códigos de error que el contrato declara para `GET /v1/events`. */
export const PUBLISHED_EVENTS_ERROR_CODES = {
  invalidAccessToken: 'invalid_access_token',
  permissionRequired: 'permission_required',
  validationError: 'validation_error',
  upstreamUnavailable: 'upstream_unavailable',
  upstreamTimeout: 'upstream_timeout',
} as const;

/**
 * Motivos de `details[].issue` del `422` de `GET /v1/events`, enumerados en la
 * descripción de la respuesta.
 */
export const PUBLISHED_EVENTS_ISSUES = [
  'invalid_datetime',
  'ends_before_starts',
  'out_of_range',
  'invalid_length',
  'invalid_cursor',
] as const;

/** Códigos de error que el contrato declara para `GET /v1/me/events/{event_id}/conflicts`. */
export const EVENT_CONFLICTS_ERROR_CODES = {
  invalidAccessToken: 'invalid_access_token',
  permissionRequired: 'permission_required',
  eventNotFound: 'event_not_found',
  upstreamUnavailable: 'upstream_unavailable',
  upstreamTimeout: 'upstream_timeout',
} as const;

/**
 * Filtro `status` de `GET /v1/me/events/{event_id}/registrations`: `REGISTERED`
 * (por defecto en el BFF) o `ALL`.
 */
export const ATTENDEE_STATUS_FILTERS = ['REGISTERED', 'ALL'] as const;
export type AttendeeStatusFilterDto = (typeof ATTENDEE_STATUS_FILTERS)[number];

/** Parámetros de la consulta de inscritos; los ausentes no se envían. */
export interface EventAttendeesQueryDto {
  readonly status?: AttendeeStatusFilterDto | null;
  /** 1–100; el BFF usa 20 si no se envía. */
  readonly limit?: number | null;
  /** Cursor opaco de `next_cursor`; la web nunca lo interpreta. */
  readonly cursor?: string | null;
}

/** Esquema `AppliedFee`: tarifa informativa de la inscripción, no un cobro. */
export interface AppliedFeeDto {
  /** Cadena decimal con dos decimales. */
  readonly amount: string;
  readonly currency: string;
}

/** Esquema `AttendeeItem`: identidad mínima, sin correo ni perfil (ADR-039). */
export interface AttendeeItemDto {
  readonly registration_id: string;
  readonly athlete_id: string;
  /** `full_name` de Usuarios; `null` si Usuarios no lo entregó. */
  readonly display_name: string | null;
  /** El contrato 0.22.0 solo publica `REGISTERED`. */
  readonly status: string;
  /** Instante UTC con sufijo `Z`. */
  readonly registered_at: string;
  readonly applied_fee: AppliedFeeDto | null;
}

/** Esquema `AttendeesSource`: estado de la consulta de nombres a Usuarios. */
export interface AttendeesSourceDto {
  readonly source: 'users';
  readonly status: 'OK' | 'UNAVAILABLE';
}

/**
 * Esquema `EventAttendeesResponse`. `total` cuenta las inscripciones que
 * cumplen el filtro; `by_status`, todas las del evento.
 */
export interface EventAttendeesResponseDto {
  readonly items: readonly AttendeeItemDto[];
  readonly total: number;
  readonly by_status: Readonly<Record<string, number>>;
  readonly next_cursor: string | null;
  readonly sources: readonly AttendeesSourceDto[];
}

/** Límites del parámetro `limit` de la consulta de inscritos. */
export const EVENT_ATTENDEES_LIMIT = { min: 1, max: 100, default: 20 } as const;

/** Códigos de error que el contrato declara para la consulta de inscritos. */
export const EVENT_ATTENDEES_ERROR_CODES = {
  invalidAccessToken: 'invalid_access_token',
  permissionRequired: 'permission_required',
  eventNotFound: 'event_not_found',
  validationError: 'validation_error',
  upstreamUnavailable: 'upstream_unavailable',
  upstreamTimeout: 'upstream_timeout',
} as const;

/** Cliente del BFF web para los eventos del organizador (HU021, HU022, HU023 y HU024). */
@Injectable({ providedIn: 'root' })
export class BffWebEventsApi {
  private readonly http = inject(HttpClient);
  private readonly bffWebUrl = inject(BffWebUrl);

  /**
   * Crea el borrador. Se devuelve la respuesta completa para leer
   * `Idempotent-Replayed`.
   *
   * @param idempotencyKey UUID (`Idempotency-Key`); igual en todos los reintentos
   * del mismo intento lógico (ADR-028, decisión 6).
   */
  createEvent(
    accessToken: string,
    body: CreateEventRequestDto,
    idempotencyKey: string,
  ): Observable<HttpResponse<EventResponseDto>> {
    return this.http.post<EventResponseDto>(this.bffWebUrl.resolve('v1/events'), body, {
      headers: new HttpHeaders({
        Authorization: `Bearer ${accessToken}`,
        'Idempotency-Key': idempotencyKey,
      }),
      observe: 'response',
    });
  }

  /** Eventos propios del organizador de la sesión (HU024, ADR-033). */
  getMyEvents(accessToken: string, query: MyEventsQueryDto): Observable<MyEventsResponseDto> {
    let params = new HttpParams({ encoder: STRICT_CODEC });
    for (const [name, value] of Object.entries(query)) {
      if (value !== null && value !== undefined && value !== '') {
        params = params.set(name, String(value));
      }
    }
    return this.http.get<MyEventsResponseDto>(this.bffWebUrl.resolve('v1/me/events'), {
      headers: bearer(accessToken),
      params,
    });
  }

  /** Eventos publicados del periodo, con filtros opcionales (HU023, ADR-040). */
  getPublishedEvents(
    accessToken: string,
    query: PublishedEventsQueryDto,
  ): Observable<PublishedEventsResponseDto> {
    let params = new HttpParams({ encoder: STRICT_CODEC });
    for (const [name, value] of Object.entries(query)) {
      if (value !== null && value !== undefined && value !== '') {
        params = params.set(name, String(value));
      }
    }
    return this.http.get<PublishedEventsResponseDto>(this.bffWebUrl.resolve('v1/events'), {
      headers: bearer(accessToken),
      params,
    });
  }

  /** Coincidencias de un evento propio con los eventos publicados (HU023 CA2). */
  getEventConflicts(accessToken: string, eventId: string): Observable<EventConflictsResponseDto> {
    return this.http.get<EventConflictsResponseDto>(
      this.bffWebUrl.resolve(`v1/me/events/${encodeURIComponent(eventId)}/conflicts`),
      { headers: bearer(accessToken) },
    );
  }

  /**
   * Inscritos de un evento propio (HU022, ADR-039). Un evento ajeno o inexistente
   * responde `404 event_not_found` sin revelar participantes.
   */
  getEventAttendees(
    accessToken: string,
    eventId: string,
    query: EventAttendeesQueryDto,
  ): Observable<EventAttendeesResponseDto> {
    let params = new HttpParams({ encoder: STRICT_CODEC });
    for (const [name, value] of Object.entries(query)) {
      if (value !== null && value !== undefined && value !== '') {
        params = params.set(name, String(value));
      }
    }
    return this.http.get<EventAttendeesResponseDto>(
      this.bffWebUrl.resolve(`v1/me/events/${encodeURIComponent(eventId)}/registrations`),
      { headers: bearer(accessToken), params },
    );
  }

  /** Detalle de un evento: `DRAFT` solo para su organizador; si no, `404`. */
  getEvent(accessToken: string, eventId: string): Observable<EventDetailResponseDto> {
    return this.http.get<EventDetailResponseDto>(
      this.bffWebUrl.resolve(`v1/events/${encodeURIComponent(eventId)}`),
      { headers: bearer(accessToken) },
    );
  }

  /**
   * Publica el evento (sin cuerpo). Se devuelve la respuesta completa para leer
   * `Idempotent-Replayed`.
   *
   * @param idempotencyKey UUID (`Idempotency-Key`); igual en todos los reintentos
   * del mismo intento lógico (ADR-033, decisiones 4 y 8).
   */
  publishEvent(
    accessToken: string,
    eventId: string,
    idempotencyKey: string,
  ): Observable<HttpResponse<EventAggregateResponseDto>> {
    return this.http.post<EventAggregateResponseDto>(
      this.bffWebUrl.resolve(`v1/events/${encodeURIComponent(eventId)}/publish`),
      null,
      {
        headers: new HttpHeaders({
          Authorization: `Bearer ${accessToken}`,
          'Idempotency-Key': idempotencyKey,
        }),
        observe: 'response',
      },
    );
  }
}

function bearer(accessToken: string): HttpHeaders {
  return new HttpHeaders({ Authorization: `Bearer ${accessToken}` });
}
