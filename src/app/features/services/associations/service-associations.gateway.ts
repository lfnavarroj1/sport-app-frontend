import {
  AssociateOutcome,
  AssociationsFilter,
  AssociationsPage,
  DissociateOutcome,
} from './service-associations.model';

/**
 * Puerto hacia el BFF web para las asociaciones a servicios médicos deportivos
 * (HU017, ADR-038). `HttpServiceAssociationsGateway` traduce el contrato bff-web
 * 0.25.0.
 */
export abstract class ServiceAssociationsGateway {
  /**
   * Página de asociaciones propias. `cursor` es el `nextCursor` anterior, sin
   * modificar. Rechaza con el error original: nunca se interpreta como lista vacía.
   */
  abstract loadPage(filter: AssociationsFilter, cursor: string | null): Promise<AssociationsPage>;

  /**
   * Asocia un servicio médico deportivo publicado.
   *
   * @param idempotencyKey igual en todos los intentos del mismo intento lógico.
   * @param onRetry se invoca antes de cada reintento automático (1, 2 o 3).
   */
  abstract associate(
    serviceId: string,
    idempotencyKey: string,
    onRetry?: (attempt: number) => void,
  ): Promise<AssociateOutcome>;

  /** Quita una asociación propia; repetirlo también confirma (`204`). */
  abstract dissociate(associationId: string): Promise<DissociateOutcome>;
}
