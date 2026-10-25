import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { ApiError, toApiError } from '../../../../../../core/api/api-error';
import { TRAINING_ATHLETES_ERROR_CODES } from '../../../../../../core/api/bff-web/training-history.api';
import { AsyncState } from '../../../../../../shared/ui/async-state/async-state';
import { ViewState, viewState } from '../../../../../../shared/ui/view-state';
import { AuthorizedAthletesGateway } from '../../../../history/authorized-athletes/authorized-athletes.gateway';
import { AuthorizedAthlete } from '../../../../history/authorized-athletes/authorized-athletes.model';

/** Primera página cargada: base de la vista. */
interface LoadedAthletes {
  readonly athletes: readonly AuthorizedAthlete[];
}

/**
 * Entrada del profesional al historial de alimentación (HU013): los deportistas
 * que lo autorizaron, por nombre y correo, en el orden estable del backend, con
 * paginación por cursor. Elegir uno abre sus consumos (`:athleteId`).
 *
 * Usa `GET /v1/me/training-athletes` (HU011, CA5): el contrato no publica una
 * lista propia de alimentación y, según ADR-037, una misma autorización de HU010
 * cubre entrenamiento, salud y alimentación (derivado; por ratificar). La lista
 * exige `training.history.view_assigned`: si el BFF la rechaza, se explica como
 * falta de permiso, nunca como lista vacía. El acceso a los consumos lo decide el
 * backend en cada consulta (CA3).
 */
@Component({
  selector: 'app-nutrition-athletes-page',
  imports: [AsyncState, DatePipe, MatButtonModule, MatCardModule, RouterLink, TranslatePipe],
  templateUrl: './nutrition-athletes-page.html',
  styleUrls: [
    '../../../../training-page.scss',
    '../../../../history/authorized-athletes/authorized-athletes-page/authorized-athletes-page.scss',
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NutritionAthletesPage {
  private readonly gateway = inject(AuthorizedAthletesGateway);
  private readonly injector = inject(Injector);

  protected readonly state = signal<ViewState<LoadedAthletes>>(viewState.loading());
  protected readonly athletes = signal<readonly AuthorizedAthlete[]>([]);
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly loadingMore = signal(false);
  protected readonly moreError = signal<ApiError | null>(null);

  protected readonly permissionDenied = computed(() => {
    const state = this.state();
    return (
      state.status === 'error' &&
      state.error.code === TRAINING_ATHLETES_ERROR_CODES.permissionRequired
    );
  });

  /** Evita que una respuesta de una carga anterior pise la vigente. */
  private generation = 0;
  private readonly list = viewChild<ElementRef<HTMLElement>>('list');

  constructor() {
    void this.loadFirst();
  }

  /** Primera página; también es el reintento. */
  protected async loadFirst(): Promise<void> {
    const generation = ++this.generation;
    this.state.set(viewState.loading());
    this.athletes.set([]);
    this.nextCursor.set(null);
    this.moreError.set(null);
    // Una página siguiente en curso queda descartada: su `finally` ya no la libera.
    this.loadingMore.set(false);
    try {
      const page = await this.gateway.loadPage(null);
      if (generation !== this.generation) {
        return;
      }
      this.athletes.set(page.athletes);
      this.nextCursor.set(page.nextCursor);
      this.state.set(
        viewState.fromData({ athletes: page.athletes }, (data) => data.athletes.length === 0),
      );
    } catch (error) {
      if (generation === this.generation) {
        this.state.set(viewState.fromError(error));
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
    const firstNew = this.athletes().length;
    this.loadingMore.set(true);
    this.moreError.set(null);
    try {
      const page = await this.gateway.loadPage(cursor);
      if (generation !== this.generation) {
        return;
      }
      this.athletes.update((athletes) => [...athletes, ...page.athletes]);
      this.nextCursor.set(page.nextCursor);
      this.focusItem(firstNew);
    } catch (error) {
      if (generation === this.generation) {
        // Los deportistas ya cargados se conservan; solo falla la página siguiente.
        this.moreError.set(toApiError(error));
      }
    } finally {
      if (generation === this.generation) {
        this.loadingMore.set(false);
      }
    }
  }

  /** Lleva el foco al primer deportista agregado para seguir con el teclado. */
  private focusItem(index: number): void {
    afterNextRender(
      () => this.list()?.nativeElement.querySelectorAll<HTMLElement>('a').item(index)?.focus(),
      { injector: this.injector },
    );
  }
}
