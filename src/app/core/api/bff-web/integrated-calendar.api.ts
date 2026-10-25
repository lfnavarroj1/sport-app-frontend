import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { BffWebUrl } from '../bff-web-url';
import { STRICT_CODEC } from './training-history.api';

/**
 * Transporte de `GET /v1/me/integrated-calendar` (operationId
 * `integrated_calendar_v1_me_integrated_calendar_get`) del contrato bff-web 0.30.0
 * (ver `contract.ts`; la operación existe sin cambios desde 0.29.0), conforme a
 * ADR-039 con el patrón de ADR-031 (HU018). El BFF compone las fuentes del actor
 * del token: la web no une respuestas de varios dominios. Se autentica con el
 * access token. Estos tipos son del transporte: la interfaz los transforma antes
 * de usarlos.
 */

/** Enumeración `name` de `IntegratedSource`: las fuentes posibles de un elemento. */
export const INTEGRATED_CALENDAR_SOURCES = [
  'OWN_EVENT',
  'EVENT_PUBLISHED',
  'EVENT_REGISTRATION',
  'TRAINING_PLAN_SESSION',
  'OWN_SERVICE_AVAILABILITY',
  'ASSOCIATED_SERVICE_AVAILABILITY',
] as const;
export type IntegratedCalendarSourceDto = (typeof INTEGRATED_CALENDAR_SOURCES)[number];

/** Enumeración `status` de `IntegratedSource`: distinta de `OK` es una fuente incompleta. */
export const INTEGRATED_SOURCE_STATUSES = ['OK', 'UNAVAILABLE', 'TIMEOUT'] as const;
export type IntegratedSourceStatusDto = (typeof INTEGRATED_SOURCE_STATUSES)[number];

/** Estados de los elementos (`status` de los seis esquemas de elemento). */
export const INTEGRATED_ITEM_STATUSES = [
  'DRAFT',
  'PUBLISHED',
  'REGISTERED',
  'ASSIGNED',
  'AVAILABLE',
] as const;
export type IntegratedItemStatusDto = (typeof INTEGRATED_ITEM_STATUSES)[number];

/** Esquema `IntegratedSource`. */
export interface IntegratedSourceDto {
  readonly name: IntegratedCalendarSourceDto;
  readonly status: IntegratedSourceStatusDto;
  /** La fuente tenía más de 200 elementos. */
  readonly truncated: boolean;
}

/** Esquema `IntegratedLocation`. */
export interface IntegratedLocationDto {
  readonly name: string;
  readonly city: string;
  readonly country_code: string;
}

/** Campos comunes de los elementos con horario (instantes en UTC con su zona IANA). */
interface TimedItemDto {
  /** `<source>:<identificador>`, único en la respuesta. */
  readonly item_id: string;
  /** Fecha de inicio en la `time_zone` del elemento. */
  readonly occurs_on: string;
  readonly title: string;
  readonly starts_at: string;
  readonly ends_at: string;
  readonly time_zone: string;
}

/** Esquema `IntegratedOwnEventItem`. */
export interface IntegratedOwnEventItemDto extends TimedItemDto {
  readonly source: 'OWN_EVENT';
  readonly status: 'DRAFT' | 'PUBLISHED';
  readonly sport: string;
  readonly location: IntegratedLocationDto;
  readonly reference: { readonly event_id: string };
}

/** Esquema `IntegratedPublishedEventItem`. */
export interface IntegratedPublishedEventItemDto extends TimedItemDto {
  readonly source: 'EVENT_PUBLISHED';
  readonly status: 'PUBLISHED';
  readonly sport: string;
  readonly location: IntegratedLocationDto;
  readonly reference: { readonly event_id: string };
}

/** Esquema `IntegratedEventRegistrationItem`. */
export interface IntegratedEventRegistrationItemDto extends TimedItemDto {
  readonly source: 'EVENT_REGISTRATION';
  readonly status: 'REGISTERED';
  readonly location: IntegratedLocationDto;
  readonly reference: { readonly event_id: string; readonly registration_id: string };
}

/** Esquema `IntegratedTrainingSessionItem`: una fecha sin hora (`scheduled_date`). */
export interface IntegratedTrainingSessionItemDto {
  readonly item_id: string;
  readonly source: 'TRAINING_PLAN_SESSION';
  readonly status: 'ASSIGNED';
  readonly occurs_on: string;
  readonly title: string;
  readonly starts_at: null;
  readonly ends_at: null;
  readonly time_zone: null;
  readonly sport: string;
  readonly duration_minutes: number;
  readonly rpe: number;
  readonly reference: { readonly plan_id: string; readonly session_id: string };
}

/** Esquema `IntegratedOwnServiceAvailabilityItem`: el estado es el del servicio propio. */
export interface IntegratedOwnServiceAvailabilityItemDto extends TimedItemDto {
  readonly source: 'OWN_SERVICE_AVAILABILITY';
  readonly status: 'DRAFT' | 'PUBLISHED';
  readonly category: string;
  readonly modality: string;
  readonly capacity: number;
  readonly reference: { readonly service_id: string };
}

/** Esquema `IntegratedAssociatedServiceAvailabilityItem`. */
export interface IntegratedAssociatedServiceAvailabilityItemDto extends TimedItemDto {
  readonly source: 'ASSOCIATED_SERVICE_AVAILABILITY';
  readonly status: 'AVAILABLE';
  readonly category: string;
  readonly modality: string;
  readonly capacity: number;
  readonly reference: { readonly service_id: string; readonly association_id: string };
}

/** Un elemento de `items`, discriminado por `source`. */
export type IntegratedCalendarItemDto =
  | IntegratedOwnEventItemDto
  | IntegratedPublishedEventItemDto
  | IntegratedEventRegistrationItemDto
  | IntegratedTrainingSessionItemDto
  | IntegratedOwnServiceAvailabilityItemDto
  | IntegratedAssociatedServiceAvailabilityItemDto;

/** Esquema `IntegratedCalendarResponse`. */
export interface IntegratedCalendarResponseDto {
  readonly from: string;
  readonly to: string;
  /** Orden del BFF: `occurs_on`, `starts_at` (nulos primero), `source`, `item_id`. */
  readonly items: readonly IntegratedCalendarItemDto[];
  readonly sources: readonly IntegratedSourceDto[];
  readonly evaluated_at: string;
}

/** Periodo de la consulta: instantes ISO 8601 con desfase. */
export interface IntegratedCalendarQueryDto {
  readonly from: string;
  readonly to: string;
}

/** Motivos de `details[].issue` del `422 validation_error` en `query.from`/`query.to`. */
export const INTEGRATED_CALENDAR_ISSUES = [
  'invalid_datetime',
  'ends_before_starts',
  'out_of_range',
  'required',
] as const;

/** Códigos de error que declara la operación. */
export const INTEGRATED_CALENDAR_ERROR_CODES = {
  invalidAccessToken: 'invalid_access_token',
  permissionRequired: 'permission_required',
  capabilityRequired: 'capability_required',
  validationError: 'validation_error',
  upstreamUnavailable: 'upstream_unavailable',
  upstreamTimeout: 'upstream_timeout',
} as const;

/** Cliente del BFF web para el calendario integrado por actor (HU018). */
@Injectable({ providedIn: 'root' })
export class BffWebIntegratedCalendarApi {
  private readonly http = inject(HttpClient);
  private readonly bffWebUrl = inject(BffWebUrl);

  /** Calendario del actor del token en `[from, to)`; la web siempre envía ambos extremos. */
  getIntegratedCalendar(
    accessToken: string,
    query: IntegratedCalendarQueryDto,
  ): Observable<IntegratedCalendarResponseDto> {
    return this.http.get<IntegratedCalendarResponseDto>(
      this.bffWebUrl.resolve('v1/me/integrated-calendar'),
      {
        headers: new HttpHeaders({ Authorization: `Bearer ${accessToken}` }),
        params: new HttpParams({ encoder: STRICT_CODEC })
          .set('from', query.from)
          .set('to', query.to),
      },
    );
  }
}
