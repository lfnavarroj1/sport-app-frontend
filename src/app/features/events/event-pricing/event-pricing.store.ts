import { Injectable, inject, signal } from '@angular/core';

import { ViewState, viewState } from '../../../shared/ui/view-state';
import { EventPricingGateway } from './event-pricing.gateway';
import { PricedEvent } from './event-pricing.model';

/**
 * Eventos propios con su tarifa (HU025). Lo comparten la lista y el detalle
 * mientras dura la ruta; vive solo en memoria. Tras un comando confirmado, el
 * evento se reemplaza con la respuesta del backend, sin esperar la proyección.
 */
@Injectable()
export class EventPricingStore {
  private readonly gateway = inject(EventPricingGateway);
  private readonly state = signal<ViewState<readonly PricedEvent[]>>(viewState.loading());

  readonly view = this.state.asReadonly();

  /** Consulta los eventos propios; también es el reintento y la actualización. */
  async load(): Promise<void> {
    this.state.set(viewState.loading());
    try {
      this.state.set(viewState.fromData(await this.gateway.loadOwnEvents()));
    } catch (error) {
      this.state.set(viewState.fromError(error));
    }
  }

  /** Evento propio con ese identificador, si la lista ya está cargada. */
  find(eventId: string | null): PricedEvent | null {
    const state = this.state();
    return state.status === 'success'
      ? (state.data.find((event) => event.id === eventId) ?? null)
      : null;
  }

  /** Reemplaza el evento con el confirmado por el comando. */
  replace(event: PricedEvent): void {
    const state = this.state();
    if (state.status === 'success') {
      this.state.set({
        status: 'success',
        data: state.data.map((current) => (current.id === event.id ? event : current)),
      });
    }
  }
}
