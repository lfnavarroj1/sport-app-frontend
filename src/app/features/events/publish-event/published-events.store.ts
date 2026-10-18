import { Injectable, computed, signal } from '@angular/core';

import { OrganizerEvent } from './publish-event.model';

/**
 * Eventos publicados durante la visita, tal como los confirmó `200` del comando
 * (HU024). La lista los quita de los borradores y los muestra entre los
 * publicados sin esperar la proyección (ADR-033). Vive mientras la ruta de
 * publicación está abierta; no se guarda en ningún almacenamiento.
 */
@Injectable()
export class PublishedEventsStore {
  private readonly published = signal<readonly OrganizerEvent[]>([]);

  /** Los más recientes primero. */
  readonly recent = this.published.asReadonly();
  readonly recentIds = computed(() => new Set(this.published().map((event) => event.id)));

  markPublished(event: OrganizerEvent): void {
    this.published.update((events) => [event, ...events.filter((item) => item.id !== event.id)]);
  }

  find(eventId: string): OrganizerEvent | null {
    return this.published().find((event) => event.id === eventId) ?? null;
  }
}
