import { ApiError } from '../../../core/api/api-error';
import {
  BillingUnitDto,
  ServiceCategoryDto,
  ServiceModalityDto,
} from '../../../core/api/bff-web/services-availability.api';
import {
  CREATE_SERVICE_ISSUES,
  CreateServiceRequestDto,
  SERVICE_CURRENCY,
  ServiceResponseDto,
} from '../../../core/api/bff-web/services.api';
import { zonedStartsAt } from '../../events/create-event/event-time';

/** Intervalo de disponibilidad que captura el profesional, en la hora local de su zona. */
export interface ServiceIntervalDraft {
  /** Fecha y hora locales (`YYYY-MM-DD`, `HH:mm`) en `timeZone`. */
  readonly startDate: string;
  readonly startTime: string;
  readonly endDate: string;
  readonly endTime: string;
  /** Zona IANA declarada. */
  readonly timeZone: string;
  readonly capacity: number;
}

/** Datos que el profesional captura (HU015). Los textos ya vienen recortados. */
export interface ServiceDraft {
  readonly name: string;
  readonly description: string;
  readonly category: ServiceCategoryDto;
  readonly modality: ServiceModalityDto;
  /** Cadena decimal con punto (`"120000.50"`); nunca un número de punto flotante. */
  readonly amount: string;
  readonly billingUnit: BillingUnitDto;
  /** Disponibilidad inicial opcional: puede estar vacía. */
  readonly intervals: readonly ServiceIntervalDraft[];
}

/** Intervalo confirmado por el backend: instantes en UTC y la zona declarada. */
export interface ServiceInterval {
  readonly startsAt: string;
  readonly endsAt: string;
  readonly timeZone: string;
  readonly capacity: number;
}

/** Servicio en borrador confirmado por el backend (`201`). */
export interface CreatedService {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: ServiceCategoryDto;
  readonly modality: ServiceModalityDto;
  readonly price: {
    readonly amount: string;
    readonly currency: typeof SERVICE_CURRENCY;
    readonly billingUnit: BillingUnitDto;
  };
  readonly intervals: readonly ServiceInterval[];
  readonly status: 'DRAFT' | 'PUBLISHED';
  readonly version: number;
  readonly createdAt: string;
}

/** Regla incumplida (`details[{field, issue}]`, ADR-027 decisión 14). */
export interface ServiceViolation {
  /** Ruta del campo (`availability[0].time_zone`); vacía si el backend no la indica. */
  readonly field: string;
  readonly issue: string;
}

/** Motivos que el cliente sabe explicar; otro motivo se muestra con un texto genérico. */
export const KNOWN_SERVICE_ISSUES: readonly string[] = CREATE_SERVICE_ISSUES;

/** Resultado del comando, ya traducido desde el contrato. */
export type CreateServiceOutcome =
  | { readonly kind: 'created'; readonly service: CreatedService; readonly replayed: boolean }
  | { readonly kind: 'invalid'; readonly violations: readonly ServiceViolation[] }
  | { readonly kind: 'failed'; readonly error: ApiError };

/**
 * Importe tal como se escribe en `es-CO` (`120000,50`) o con punto, convertido a
 * la cadena del contrato (`120000.50`) sin pasar por un número de punto
 * flotante. No elimina separadores de miles: un valor con ellos no cumple el
 * patrón y el formulario lo marca.
 */
export function normalizeAmount(text: string): string {
  return text.trim().replace(',', '.');
}

/**
 * Cuerpo exacto de ADR-027: sin `provider_id`, estado ni datos de pago. Cada
 * instante lleva el desfase de su zona IANA en ese momento; sin intervalos, se
 * omite `availability`.
 */
export function toCreateServiceRequest(draft: ServiceDraft): CreateServiceRequestDto {
  const request: CreateServiceRequestDto = {
    name: draft.name,
    description: draft.description,
    category: draft.category,
    modality: draft.modality,
    price: {
      amount: draft.amount,
      currency: SERVICE_CURRENCY,
      billing_unit: draft.billingUnit,
    },
  };
  if (draft.intervals.length === 0) {
    return request;
  }
  return {
    ...request,
    availability: draft.intervals.map((interval) => ({
      starts_at: zonedStartsAt(interval.startDate, interval.startTime, interval.timeZone),
      ends_at: zonedStartsAt(interval.endDate, interval.endTime, interval.timeZone),
      time_zone: interval.timeZone,
      capacity: interval.capacity,
    })),
  };
}

export function toCreatedService(dto: ServiceResponseDto): CreatedService {
  return {
    id: dto.service_id,
    name: dto.name,
    description: dto.description,
    category: dto.category,
    modality: dto.modality,
    price: {
      amount: dto.price.amount,
      currency: dto.price.currency,
      billingUnit: dto.price.billing_unit,
    },
    intervals: dto.availability.map((interval) => ({
      startsAt: interval.starts_at,
      endsAt: interval.ends_at,
      timeZone: interval.time_zone,
      capacity: interval.capacity,
    })),
    status: dto.status,
    version: dto.version,
    createdAt: dto.created_at,
  };
}
