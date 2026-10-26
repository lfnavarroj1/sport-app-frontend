import { Injectable, signal } from '@angular/core';

import { PublishedService } from './publish-service.model';

/**
 * Publicaciones confirmadas durante la visita (HU019). Servicios complementarios
 * usa una sola base sin proyección (ADR-027): tras el `200`, la lista vuelve a
 * consultar el backend y ya refleja el cambio; `changes` avisa cuándo hacerlo.
 * Vive mientras la ruta de publicación está abierta; no se guarda en ningún
 * almacenamiento.
 */
@Injectable()
export class ServicePublicationsStore {
  private readonly published = signal<ReadonlyMap<string, PublishedService>>(new Map());
  private readonly count = signal(0);

  /** Aumenta con cada publicación confirmada. */
  readonly changes = this.count.asReadonly();

  markPublished(service: PublishedService): void {
    this.published.update((current) => new Map(current).set(service.id, service));
    this.count.update((value) => value + 1);
  }

  find(serviceId: string): PublishedService | null {
    return this.published().get(serviceId) ?? null;
  }
}
