import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { ActivatedRoute } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { ApiError, toApiError } from '../../../../core/api/api-error';
import {
  ATTENDEE_STATUS_FILTERS,
  EVENT_ATTENDEES_ERROR_CODES,
} from '../../../../core/api/bff-web/events.api';
import { AsyncState } from '../../../../shared/ui/async-state/async-state';
import { ViewState, viewState } from '../../../../shared/ui/view-state';
import { AttendeesGateway } from '../attendees.gateway';
import {
  Attendee,
  AttendeeFilter,
  AttendeesPage,
  KNOWN_ATTENDEE_STATUSES,
  formatFee,
} from '../attendees.model';
import { OwnEventsStore } from '../own-events.store';

/**
 * Inscritos de un evento propio (HU022, ADR-039) en
 * `/organizador/eventos/inscritos/:eventId`: conteos por estado de todo el
 * evento, filtro de estado, lista con nombre, estado, fecha y tarifa aplicada
 * (informativa) en el orden del backend y «Cargar más» con el cursor sin
 * modificar (CA1, CA4). Un evento ajeno o inexistente responde `404` sin datos
 * (CA2); sin inscritos se ve el total cero (CA3); si Usuarios no responde, los
 * nombres faltan y se avisa, sin ocultar el resto (CA6). Sin exportación ni datos
 * de contacto.
 */
@Component({
  selector: 'app-event-attendees-list',
  imports: [
    AsyncState,
    DatePipe,
    MatButtonModule,
    MatButtonToggleModule,
    MatCardModule,
    TranslatePipe,
  ],
  templateUrl: './event-attendees-list.html',
  styleUrls: ['../../create-event/events-page.scss', './event-attendees-list.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventAttendeesList {
  private readonly gateway = inject(AttendeesGateway);
  private readonly store = inject(OwnEventsStore);

  protected readonly filters = ATTENDEE_STATUS_FILTERS;
  protected readonly eventId = signal<string | null>(null);
  protected readonly filter = signal<AttendeeFilter>('REGISTERED');
  protected readonly state = signal<ViewState<AttendeesPage>>(viewState.loading());
  protected readonly loadingMore = signal(false);
  protected readonly moreError = signal<ApiError | null>(null);
  private generation = 0;

  /** Evento elegido, si la lista de eventos propios ya está cargada. */
  protected readonly event = computed(() => this.store.find(this.eventId()));

  protected readonly page = computed(() => {
    const state = this.state();
    return state.status === 'success' ? state.data : null;
  });

  protected readonly notFound = computed(() => {
    const state = this.state();
    return (
      state.status === 'error' && state.error.code === EVENT_ATTENDEES_ERROR_CODES.eventNotFound
    );
  });

  constructor() {
    inject(ActivatedRoute)
      .paramMap.pipe(takeUntilDestroyed(inject(DestroyRef)))
      .subscribe((params) => {
        this.eventId.set(params.get('eventId'));
        this.filter.set('REGISTERED');
        void this.loadFirst();
      });
  }

  /** Primera página con el filtro vigente; también es el reintento. */
  protected async loadFirst(): Promise<void> {
    const eventId = this.eventId();
    if (eventId === null) {
      return;
    }
    const generation = ++this.generation;
    this.state.set(viewState.loading());
    this.loadingMore.set(false);
    this.moreError.set(null);
    try {
      const page = await this.gateway.loadAttendees(eventId, this.filter(), null);
      if (generation === this.generation) {
        this.state.set({ status: 'success', data: page });
      }
    } catch (error) {
      if (generation === this.generation) {
        this.state.set(viewState.fromError(error));
      }
    }
  }

  /** Página siguiente con el cursor del backend, sin modificarlo (CA4). */
  protected async loadMore(): Promise<void> {
    const eventId = this.eventId();
    const current = this.page();
    if (eventId === null || current?.nextCursor == null || this.loadingMore()) {
      return;
    }
    const generation = this.generation;
    this.loadingMore.set(true);
    this.moreError.set(null);
    try {
      const next = await this.gateway.loadAttendees(eventId, this.filter(), current.nextCursor);
      if (generation === this.generation) {
        this.state.set({
          status: 'success',
          data: { ...next, attendees: [...current.attendees, ...next.attendees] },
        });
      }
    } catch (error) {
      if (generation === this.generation) {
        this.moreError.set(toApiError(error));
      }
    } finally {
      if (generation === this.generation) {
        this.loadingMore.set(false);
      }
    }
  }

  protected selectFilter(filter: AttendeeFilter): void {
    if (filter !== this.filter()) {
      this.filter.set(filter);
      void this.loadFirst();
    }
  }

  /** Clave i18n del estado, o `null` si el backend envía uno que la web no conoce. */
  protected statusKey(status: string): string | null {
    return KNOWN_ATTENDEE_STATUSES.includes(status) ? `events.attendees.status.${status}` : null;
  }

  protected fee(attendee: Attendee): string | null {
    return attendee.appliedFee === null
      ? null
      : formatFee(attendee.appliedFee.amount, attendee.appliedFee.currency);
  }
}
