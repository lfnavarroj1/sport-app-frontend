import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  LOCALE_ID,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { ApiError, toApiError } from '../../../../core/api/api-error';
import { AsyncState } from '../../../../shared/ui/async-state/async-state';
import { ViewState, viewState } from '../../../../shared/ui/view-state';
import { formatInZone } from '../../create-event/event-time';
import { PublishEventGateway } from '../publish-event.gateway';
import { EventStatus, OrganizerEvent } from '../publish-event.model';
import { PublishedEventsStore } from '../published-events.store';

/** Evento en la lista; `recent` si solo lo confirma el comando de esta visita. */
interface ListedEvent {
  readonly event: OrganizerEvent;
  readonly recent: boolean;
}

/**
 * Publicar eventos (HU024) en `/organizador/eventos/publicacion`: borradores y
 * publicados propios, en el orden estable del backend (`starts_at` y
 * `event_id` ascendentes) y con paginación por cursor. Elegir uno abre su
 * detalle en `:eventId` (maestro-detalle, ADR-012), donde se publica.
 *
 * Un evento publicado en esta visita sale de los borradores y aparece entre los
 * publicados con la respuesta del comando, sin esperar la proyección (ADR-033).
 */
@Component({
  selector: 'app-publish-events-page',
  imports: [
    AsyncState,
    DatePipe,
    MatButtonModule,
    MatButtonToggleModule,
    MatCardModule,
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    TranslatePipe,
  ],
  templateUrl: './publish-events-page.html',
  styleUrls: ['../../create-event/events-page.scss', './publish-events-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublishEventsPage {
  private readonly gateway = inject(PublishEventGateway);
  private readonly store = inject(PublishedEventsStore);
  private readonly locale = inject(LOCALE_ID);
  private readonly injector = inject(Injector);

  protected readonly status = signal<EventStatus>('DRAFT');
  /** Estado de la consulta al backend (la primera página de la pestaña). */
  private readonly loaded = signal<ViewState<true>>(viewState.loading());
  private readonly events = signal<readonly OrganizerEvent[]>([]);
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly loadingMore = signal(false);
  protected readonly moreError = signal<ApiError | null>(null);
  /** Hay un evento abierto en el detalle (ruta hija `:eventId`). */
  protected readonly detailOpen = signal(false);

  /** Lo que se muestra: la respuesta del backend más lo confirmado por el comando. */
  protected readonly listed = computed<readonly ListedEvent[]>(() => {
    const fromBackend = this.events();
    const recentIds = this.store.recentIds();
    if (this.status() === 'DRAFT') {
      return fromBackend
        .filter((event) => !recentIds.has(event.id))
        .map((event) => ({ event, recent: false }));
    }
    const listedIds = new Set(fromBackend.map((event) => event.id));
    return [
      ...this.store
        .recent()
        .filter((event) => !listedIds.has(event.id))
        .map((event) => ({ event, recent: true })),
      ...fromBackend.map((event) => ({ event, recent: false })),
    ];
  });

  protected readonly state = computed<ViewState<readonly ListedEvent[]>>(() => {
    const loaded = this.loaded();
    if (loaded.status === 'loading' || loaded.status === 'error') {
      return loaded;
    }
    return viewState.fromData(this.listed(), (listed) => listed.length === 0);
  });

  protected readonly emptyKey = computed(() => `events.publish.list.empty.${this.status()}`);

  /** Evita que una respuesta de otra pestaña o de una carga anterior pise la vigente. */
  private generation = 0;
  private readonly list = viewChild<ElementRef<HTMLElement>>('list');

  constructor() {
    void this.loadFirst();
  }

  protected selectStatus(status: EventStatus): void {
    if (status !== this.status()) {
      this.status.set(status);
      void this.loadFirst();
    }
  }

  /** Primera página de la pestaña vigente; también es el reintento. */
  protected async loadFirst(): Promise<void> {
    const generation = ++this.generation;
    this.loaded.set(viewState.loading());
    this.events.set([]);
    this.nextCursor.set(null);
    this.moreError.set(null);
    this.loadingMore.set(false);
    try {
      const page = await this.gateway.loadEvents(this.status(), null);
      if (generation !== this.generation) {
        return;
      }
      this.events.set(page.events);
      this.nextCursor.set(page.nextCursor);
      this.loaded.set({ status: 'success', data: true });
    } catch (error) {
      if (generation === this.generation) {
        this.loaded.set(viewState.fromError(error));
      }
    }
  }

  /** Página siguiente con el cursor tal como lo entregó el backend. */
  protected async loadMore(): Promise<void> {
    const cursor = this.nextCursor();
    if (cursor === null || this.loadingMore()) {
      return;
    }
    const generation = this.generation;
    const firstNew = this.listed().length;
    this.loadingMore.set(true);
    this.moreError.set(null);
    try {
      const page = await this.gateway.loadEvents(this.status(), cursor);
      if (generation !== this.generation) {
        return;
      }
      this.events.update((events) => [...events, ...page.events]);
      this.nextCursor.set(page.nextCursor);
      this.focusItem(firstNew);
    } catch (error) {
      if (generation === this.generation) {
        // Los eventos ya cargados se conservan; solo falla la página siguiente.
        this.moreError.set(toApiError(error));
      }
    } finally {
      if (generation === this.generation) {
        this.loadingMore.set(false);
      }
    }
  }

  protected inZone(iso: string, event: OrganizerEvent): string {
    return formatInZone(iso, event.timeZone, this.locale);
  }

  /** Lleva el foco al primer evento agregado para seguir con el teclado. */
  private focusItem(index: number): void {
    afterNextRender(
      () => this.list()?.nativeElement.querySelectorAll<HTMLElement>('a').item(index)?.focus(),
      { injector: this.injector },
    );
  }
}
