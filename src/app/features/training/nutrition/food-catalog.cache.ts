import { Injectable } from '@angular/core';

import { FoodCatalog } from './nutrition-plan.model';

/**
 * Último catálogo de alimentos recibido y su `ETag`, solo en memoria durante la
 * sesión de la pestaña. El catálogo no es un dato personal; se conserva para
 * revalidarlo con `If-None-Match` y aprovechar el `304` del BFF.
 */
@Injectable({ providedIn: 'root' })
export class FoodCatalogCache {
  private entry: { readonly etag: string; readonly catalog: FoodCatalog } | null = null;

  get etag(): string | null {
    return this.entry?.etag ?? null;
  }

  get catalog(): FoodCatalog | null {
    return this.entry?.catalog ?? null;
  }

  store(etag: string | null, catalog: FoodCatalog): void {
    // Sin `ETag` no se puede revalidar: el catálogo se vuelve a pedir completo.
    this.entry = etag === null ? null : { etag, catalog };
  }
}
