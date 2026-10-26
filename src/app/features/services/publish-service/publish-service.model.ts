import { ApiError } from '../../../core/api/api-error';
import {
  PublishServiceResponseDto,
  ServiceResponseDto,
  ServiceStatusDto,
} from '../../../core/api/bff-web/services.api';
import {
  CreatedService,
  ServiceInterval,
  toCreatedService,
} from '../create-service/create-service.model';

/** Estado del servicio (ADR-027): la única transición es `DRAFT` → `PUBLISHED`. */
export type ServiceStatus = ServiceStatusDto;

/** Servicio propio del profesional, tal como lo confirma el backend; instantes en UTC. */
export interface OwnService extends CreatedService {
  /** `null` mientras es borrador. */
  readonly publishedAt: string | null;
}

/** Una página de servicios propios en el orden del backend. */
export interface OwnServicesPage {
  readonly services: readonly OwnService[];
  /** Cursor opaco de la página siguiente; `null` si no hay más. */
  readonly nextCursor: string | null;
}

/** Resultado confirmado por `200` del comando de publicar. */
export interface PublishedService {
  readonly id: string;
  readonly status: 'PUBLISHED';
  readonly version: number;
  readonly publishedAt: string;
  readonly updatedAt: string;
}

/** Requisito incumplido (`details[{field, issue}]` de un `422`, CA2). */
export interface PublishViolation {
  /** Ruta del campo (`availability`, `price.amount`); vacía si el backend no la indica. */
  readonly field: string;
  readonly issue: string;
}

/** Resultado del comando de publicar, ya traducido desde el contrato. */
export type PublishOutcome =
  | { readonly kind: 'published'; readonly service: PublishedService; readonly replayed: boolean }
  | { readonly kind: 'invalid'; readonly violations: readonly PublishViolation[] }
  | { readonly kind: 'failed'; readonly error: ApiError };

/**
 * Filas del detalle junto a las que se muestran los requisitos faltantes. La
 * tarifa en COP, la unidad de cobro y la disponibilidad futura son requisitos
 * separados (T-HU019-WEB).
 */
export type DetailRow =
  'name' | 'description' | 'category' | 'modality' | 'price' | 'billingUnit' | 'availability';

/**
 * Fila del detalle que representa el campo de un requisito incumplido; `null`
 * si no tiene una fila propia (se informa solo en el resumen).
 */
export function rowFor(field: string): DetailRow | null {
  if (field === 'availability' || field.startsWith('availability[')) {
    return 'availability';
  }
  const rows: Readonly<Record<string, DetailRow>> = {
    name: 'name',
    description: 'description',
    category: 'category',
    modality: 'modality',
    price: 'price',
    'price.amount': 'price',
    'price.currency': 'price',
    'price.billing_unit': 'billingUnit',
  };
  return rows[field] ?? null;
}

/**
 * Intervalos que todavía no empiezan. Solo sirve para advertir antes de enviar:
 * la regla autoritativa («al menos un intervalo futuro», ADR-027) la aplica el
 * backend al publicar.
 */
export function futureIntervals(
  intervals: readonly ServiceInterval[],
  now: number = Date.now(),
): readonly ServiceInterval[] {
  return intervals.filter((interval) => new Date(interval.startsAt).getTime() > now);
}

export function toOwnService(dto: ServiceResponseDto): OwnService {
  return { ...toCreatedService(dto), publishedAt: dto.published_at };
}

export function toPublishedService(dto: PublishServiceResponseDto): PublishedService {
  return {
    id: dto.service_id,
    status: dto.status,
    version: dto.version,
    publishedAt: dto.published_at,
    updatedAt: dto.updated_at,
  };
}
