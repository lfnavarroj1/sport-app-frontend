import { ApiError } from '../../../core/api/api-error';
import {
  AssociationStatusDto,
  ServiceAssociationResponseDto,
} from '../../../core/api/bff-web/service-associations.api';
import { BillingUnit, ServiceCategory, ServiceModality } from '../availability/availability.model';

export type AssociationStatus = AssociationStatusDto;

/**
 * Qué asociaciones consulta «Mis servicios asociados»: solo las activas o, con
 * el historial, también las quitadas (`status=ALL`, CA5).
 */
export type AssociationsFilter = 'ACTIVE' | 'ALL';

/** Asociación del deportista a un servicio médico deportivo, para la pantalla (HU017). */
export interface ServiceAssociation {
  readonly id: string;
  readonly serviceId: string;
  readonly name: string;
  readonly category: ServiceCategory;
  readonly modality: ServiceModality;
  /** Tarifa informativa en COP: asociar no contrata ni paga. */
  readonly fee: {
    /** Cadena decimal tal como la envía el backend. */
    readonly amount: string;
    readonly billingUnit: BillingUnit;
  };
  readonly status: AssociationStatus;
  /** Instante UTC. */
  readonly associatedAt: string;
  /** Instante UTC en que se quitó; `null` mientras está activa. */
  readonly endedAt: string | null;
  readonly version: number;
}

/** Una página de asociaciones, de la más reciente a la más antigua. */
export interface AssociationsPage {
  readonly associations: readonly ServiceAssociation[];
  /** Cursor opaco de la página siguiente; `null` si no hay más. */
  readonly nextCursor: string | null;
}

/** Resultado de asociar; un fallo nunca se expresa como éxito. */
export type AssociateOutcome =
  | {
      readonly kind: 'associated';
      readonly association: ServiceAssociation;
      /** El BFF devolvió el resultado de un intento anterior con la misma clave. */
      readonly replayed: boolean;
    }
  /** `409 association_exists` (CA3): `associationId` es la activa que informa `details`. */
  | { readonly kind: 'exists'; readonly associationId: string | null }
  | { readonly kind: 'failed'; readonly error: ApiError };

/** Resultado de quitar una asociación. */
export type DissociateOutcome =
  { readonly kind: 'dissociated' } | { readonly kind: 'failed'; readonly error: ApiError };

export function toServiceAssociation(dto: ServiceAssociationResponseDto): ServiceAssociation {
  return {
    id: dto.association_id,
    serviceId: dto.service_id,
    name: dto.service.name,
    category: dto.service.category,
    modality: dto.service.modality,
    fee: { amount: dto.service.fee.amount, billingUnit: dto.service.fee.billing_unit },
    status: dto.status,
    associatedAt: dto.associated_at,
    endedAt: dto.ended_at,
    version: dto.version,
  };
}
