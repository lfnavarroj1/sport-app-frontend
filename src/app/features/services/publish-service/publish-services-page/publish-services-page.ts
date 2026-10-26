import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
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
import { formatPrice } from '../../availability/availability-format';
import { PublishServiceGateway } from '../publish-service.gateway';
import { OwnService, ServiceStatus, futureIntervals } from '../publish-service.model';
import { ServicePublicationsStore } from '../service-publications.store';

/**
 * Publicar servicios (HU019) en `/profesional/servicios/publicacion`: borradores y
 * publicados propios (`GET /v1/me/services`), en el orden del backend y con
 * paginación por cursor. Elegir uno abre su detalle en `:serviceId`
 * (maestro-detalle, ADR-012), donde se revisan los requisitos y se publica.
 *
 * Servicios complementarios no tiene proyección (ADR-027): tras una publicación
 * confirmada, la pestaña vigente se vuelve a consultar y ya refleja el cambio.
 */
@Component({
  selector: 'app-publish-services-page',
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
  templateUrl: './publish-services-page.html',
  styleUrls: ['../../create-service/services-page.scss', './publish-services-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublishServicesPage {
  private readonly gateway = inject(PublishServiceGateway);
  private readonly store = inject(ServicePublicationsStore);
  private readonly injector = inject(Injector);

  protected readonly status = signal<ServiceStatus>('DRAFT');
  /** Estado de la consulta al backend (la primera página de la pestaña). */
  private readonly loaded = signal<ViewState<true>>(viewState.loading());
  protected readonly services = signal<readonly OwnService[]>([]);
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly loadingMore = signal(false);
  protected readonly moreError = signal<ApiError | null>(null);
  /** Hay un servicio abierto en el detalle (ruta hija `:serviceId`). */
  protected readonly detailOpen = signal(false);

  protected readonly state = computed<ViewState<readonly OwnService[]>>(() => {
    const loaded = this.loaded();
    if (loaded.status === 'loading' || loaded.status === 'error') {
      return loaded;
    }
    return viewState.fromData(this.services(), (services) => services.length === 0);
  });

  protected readonly emptyKey = computed(() => `services.publish.list.empty.${this.status()}`);

  /** Evita que una respuesta de otra pestaña o de una carga anterior pise la vigente. */
  private generation = 0;
  private readonly list = viewChild<ElementRef<HTMLElement>>('list');

  constructor() {
    void this.loadFirst();
    // Una publicación confirmada cambia las pestañas: se vuelve a consultar la vigente.
    let seen = this.store.changes();
    effect(() => {
      const changes = this.store.changes();
      if (changes !== seen) {
        seen = changes;
        untracked(() => void this.loadFirst());
      }
    });
  }

  protected selectStatus(status: ServiceStatus): void {
    if (status !== this.status()) {
      this.status.set(status);
      void this.loadFirst();
    }
  }

  /** Primera página de la pestaña vigente; también es el reintento. */
  protected async loadFirst(): Promise<void> {
    const generation = ++this.generation;
    this.loaded.set(viewState.loading());
    this.services.set([]);
    this.nextCursor.set(null);
    this.moreError.set(null);
    this.loadingMore.set(false);
    try {
      const page = await this.gateway.loadServices(this.status(), null);
      if (generation !== this.generation) {
        return;
      }
      this.services.set(page.services);
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
    const firstNew = this.services().length;
    this.loadingMore.set(true);
    this.moreError.set(null);
    try {
      const page = await this.gateway.loadServices(this.status(), cursor);
      if (generation !== this.generation) {
        return;
      }
      this.services.update((services) => [...services, ...page.services]);
      this.nextCursor.set(page.nextCursor);
      this.focusItem(firstNew);
    } catch (error) {
      if (generation === this.generation) {
        // Los servicios ya cargados se conservan; solo falla la página siguiente.
        this.moreError.set(toApiError(error));
      }
    } finally {
      if (generation === this.generation) {
        this.loadingMore.set(false);
      }
    }
  }

  /** Tarifa informativa en `es-CO`; el dato sigue siendo la cadena del backend. */
  protected price(service: OwnService): string {
    return formatPrice(service.price.amount);
  }

  protected futureCount(service: OwnService): number {
    return futureIntervals(service.intervals).length;
  }

  /** Lleva el foco al primer servicio agregado para seguir con el teclado. */
  private focusItem(index: number): void {
    afterNextRender(
      () => this.list()?.nativeElement.querySelectorAll<HTMLElement>('a').item(index)?.focus(),
      { injector: this.injector },
    );
  }
}
