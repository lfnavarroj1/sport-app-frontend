import { HttpClient, HttpHeaders, HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { BffWebUrl } from '../bff-web-url';

/**
 * Transporte de `POST /v1/events` (operationId `create_v1_events_post`) del
 * contrato bff-web 0.15.0 (ver `contract.ts`), conforme a ADR-028 (HU021). Se
 * autentica con el access token; `organizer_id` sale del token y nunca viaja en
 * el cuerpo. Estos tipos son del transporte: la interfaz los transforma antes de
 * usarlos.
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

/** Cliente del BFF web para la creación de eventos (HU021). */
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
}
