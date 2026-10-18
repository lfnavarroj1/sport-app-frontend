import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { ApiError, toApiError } from '../../../../../core/api/api-error';
import { AsyncState } from '../../../../../shared/ui/async-state/async-state';
import { ViewState, viewState } from '../../../../../shared/ui/view-state';
import { AuthorizedAthletesGateway } from '../authorized-athletes.gateway';
import { AuthorizedAthlete } from '../authorized-athletes.model';

/** Primera página cargada: base de la vista. */
interface LoadedAthletes {
  readonly athletes: readonly AuthorizedAthlete[];
}

/**
 * Entrada del profesional al historial (HU011, CA5): los deportistas que lo
 * autorizaron, por nombre y correo, en el orden estable del backend
 * (`authorized_at` y `athlete_id` descendentes), con paginación por cursor.
 * Elegir uno abre su historial (`:athleteId`). No hay búsqueda ni ingreso de
 * identificadores: la lista sale solo de las autorizaciones vigentes que decide
 * el backend, y una revocación retira al deportista cuando se proyecta. El
 * acceso desde un plan de HU010 se conserva como atajo.
 */
@Component({
  selector: 'app-authorized-athletes-page',
  imports: [AsyncState, DatePipe, MatButtonModule, MatCardModule, RouterLink, TranslatePipe],
  templateUrl: './authorized-athletes-page.html',
  styleUrls: ['../../../training-page.scss', './authorized-athletes-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthorizedAthletesPage {
  private readonly gateway = inject(AuthorizedAthletesGateway);
  private readonly injector = inject(Injector);

  protected readonly state = signal<ViewState<LoadedAthletes>>(viewState.loading());
  protected readonly athletes = signal<readonly AuthorizedAthlete[]>([]);
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly loadingMore = signal(false);
  protected readonly moreError = signal<ApiError | null>(null);

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
