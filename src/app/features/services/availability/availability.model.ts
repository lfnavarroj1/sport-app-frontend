import {
  BillingUnitDto,
  SERVICES_AVAILABILITY_LIMITS,
  ServiceAvailabilityResponseDto,
  ServiceCategoryDto,
  ServiceModalityDto,
} from '../../../core/api/bff-web/services-availability.api';

export type ServiceCategory = ServiceCategoryDto;
export type ServiceModality = ServiceModalityDto;
export type BillingUnit = BillingUnitDto;

/** Filtros que elige el deportista (HU020). Las fechas son días locales `YYYY-MM-DD`. */
export interface AvailabilityFilters {
  /** Primer día del periodo, inclusivo. */
  readonly fromDate: string;
  /** Último día del periodo, inclusivo. */
  readonly toDate: string;
  /** Vacío = todas las categorías visibles para el deportista. */
  readonly categories: readonly ServiceCategory[];
  /** Vacío = todas las modalidades. */
  readonly modalities: readonly ServiceModality[];
  /** `true` → `availability=all` (CA2); `false` → `available`. */
  readonly includeUnavailable: boolean;
}

/** Intervalo `[startsAt, endsAt)` en UTC, con la zona declarada del servicio. */
export interface ServiceInterval {
  readonly startsAt: string;
  readonly endsAt: string;
  readonly timeZone: string;
  readonly capacity: number;
}

/** Servicio publicado del catálogo, transformado para la pantalla. */
export interface CatalogEntry {
  readonly id: string;
  readonly providerId: string;
  readonly name: string;
  readonly description: string;
  readonly category: ServiceCategory;
  readonly modality: ServiceModality;
  /** Tarifa informativa en COP (CA6): no es un cobro ni un beneficio del plan. */
  readonly price: {
    /** Cadena decimal tal como la envía el backend. */
    readonly amount: string;
    readonly currency: 'COP';
    readonly billingUnit: BillingUnit;
  };
  readonly intervals: readonly ServiceInterval[];
  /** `false` solo con `includeUnavailable` y sin intervalos en el periodo (CA2). */
  readonly available: boolean;
}

/** Una página del catálogo, en el orden estable del backend (`name`, `service_id`). */
export interface AvailabilityPage {
  readonly services: readonly CatalogEntry[];
  /** Cursor opaco de la página siguiente; `null` si no hay más. */
  readonly nextCursor: string | null;
  /** Categorías omitidas por falta de capacidad del plan (CA1). */
  readonly restrictedCategories: readonly ServiceCategory[];
}

/** Días como máximo que puede abarcar el periodo (contrato: hasta 31 días). */
export const MAX_PERIOD_DAYS = SERVICES_AVAILABILITY_LIMITS.maxPeriodDays;

export function toAvailabilityPage(dto: ServiceAvailabilityResponseDto): AvailabilityPage {
  return {
    services: dto.items.map((item) => ({
      id: item.service_id,
      providerId: item.provider_id,
      name: item.name,
      description: item.description,
      category: item.category,
      modality: item.modality,
      price: {
        amount: item.price.amount,
        currency: item.price.currency,
        billingUnit: item.price.billing_unit,
      },
      intervals: item.availability.map((interval) => ({
        startsAt: interval.starts_at,
        endsAt: interval.ends_at,
        timeZone: interval.time_zone,
        capacity: interval.capacity,
      })),
      available: item.available,
    })),
    nextCursor: dto.next_cursor,
    restrictedCategories: [...dto.restricted_categories],
  };
}

/**
 * Periodo `[from, to)` de la consulta: desde las 00:00 locales de `fromDate` hasta
 * las 00:00 locales del día siguiente a `toDate`, como instantes ISO 8601 con el
 * desfase del navegador en cada fecha (`2026-11-03T00:00:00-05:00`).
 */
export function queryPeriod(filters: AvailabilityFilters): { from: string; to: string } {
  const end = localMidnight(filters.toDate);
  end.setDate(end.getDate() + 1);
  return { from: withOffset(localMidnight(filters.fromDate)), to: withOffset(end) };
}

/** Días que abarca el periodo, contando ambos extremos (1 si son el mismo día). */
export function periodDays(fromDate: string, toDate: string): number {
  const from = localMidnight(fromDate);
  const to = localMidnight(toDate);
  return Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
}

/** Día local `YYYY-MM-DD` desplazado `days` días desde `date`. */
export function addDays(date: Date, days: number): string {
  const shifted = new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  return [
    shifted.getFullYear(),
    String(shifted.getMonth() + 1).padStart(2, '0'),
    String(shifted.getDate()).padStart(2, '0'),
  ].join('-');
}

function localMidnight(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function withOffset(date: Date): string {
  const offset = -date.getTimezoneOffset();
  const sign = offset < 0 ? '-' : '+';
  const absolute = Math.abs(offset);
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:00` +
    `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`
  );
}
