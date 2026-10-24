import { Injectable, inject, signal } from '@angular/core';

import { ViewState, viewState } from '../../../shared/ui/view-state';
import { OrganizerEvent } from '../publish-event/publish-event.model';
import { AttendeesGateway } from './attendees.gateway';

/**
 * Eventos propios del organizador para el selector de inscritos (HU022). Lo
 * comparten la vista maestra (selector) y el detalle (nombre del evento elegido)
 * mientras dura la ruta; vive solo en memoria.
 */
@Injectable()
export class OwnEventsStore {
  private readonly gateway = inject(AttendeesGateway);
  private readonly state = signal<ViewState<readonly OrganizerEvent[]>>(viewState.loading());

  readonly view = this.state.asReadonly();

  /** Consulta los eventos propios; también es el reintento. */
  async load(): Promise<void> {
    this.state.set(viewState.loading());
    try {
      this.state.set(viewState.fromData(await this.gateway.loadOwnEvents()));
    } catch (error) {
      this.state.set(viewState.fromError(error));
    }
  }

  /** Evento propio con ese identificador, si la lista ya está cargada. */
  find(eventId: string | null): OrganizerEvent | null {
    const state = this.state();
    return state.status === 'success'
      ? (state.data.find((event) => event.id === eventId) ?? null)
      : null;
  }
}
