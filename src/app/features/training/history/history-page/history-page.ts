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
import { FormControl, FormGroup, FormGroupDirective, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { ApiError, toApiError } from '../../../../core/api/api-error';
import { TRAINING_HISTORY_ERROR_CODES } from '../../../../core/api/bff-web/training-history.api';
import { AsyncState } from '../../../../shared/ui/async-state/async-state';
import { ViewState, viewState } from '../../../../shared/ui/view-state';
import { SPORT_OPTIONS, Sport } from '../../training-plan.model';
import { HistoryGateway } from '../history.gateway';
import {
  HistoryFilters,
  HistoryScope,
  HistorySession,
  NO_FILTERS,
  durationText,
  hasFilters,
} from '../history.model';

const ATHLETE_NOT_AUTHORIZED = TRAINING_HISTORY_ERROR_CODES.athleteAuthorizationRequired;

/** Primera página cargada: base de la vista. */
interface LoadedHistory {
  readonly sessions: readonly HistorySession[];
}

/**
 * Historial de entrenamiento (HU011): sesiones terminadas en el orden estable del
 * backend (`ended_at` y `session_id` descendentes), con filtros por periodo y
 * deporte, paginación por cursor («Cargar más») y detalle de la sesión elegida.
 *
 * El mismo componente sirve al deportista (`scope: own`) y al profesional
 * autorizado (`:athleteId`). La autorización la decide el backend: un `403` se
 * explica sin mostrar datos (CA3). Una página nueva se agrega tal como llega,
 * sin reordenar ni filtrar en el cliente (CA4).
 */
@Component({
  selector: 'app-history-page',
  imports: [
    AsyncState,
    DatePipe,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    ReactiveFormsModule,
    RouterLink,
    TranslatePipe,
  ],
  templateUrl: './history-page.html',
  styleUrls: ['../../training-page.scss', './history-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HistoryPage {
  private readonly gateway = inject(HistoryGateway);
  private readonly route = inject(ActivatedRoute);
  private readonly injector = inject(Injector);

  protected readonly scope: HistoryScope = this.resolveScope();
  /** Ruta de consulta de planes (HU010), solo para el profesional. */
  protected readonly planRoute =
    (this.route.snapshot.data['planRoute'] as string | undefined) ?? null;

  protected readonly form = new FormGroup({
    from: new FormControl('', { nonNullable: true }),
    to: new FormControl('', { nonNullable: true }),
    sport: new FormControl<Sport | null>(null),
  });

  /** Filtros de la consulta vigente (los del formulario al aplicarlos). */
  protected readonly applied = signal<HistoryFilters>(NO_FILTERS);
  protected readonly state = signal<ViewState<LoadedHistory>>(viewState.loading());
  protected readonly sessions = signal<readonly HistorySession[]>([]);
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly loadingMore = signal(false);
  protected readonly moreError = signal<ApiError | null>(null);
  protected readonly selectedId = signal<string | null>(null);
  /** Deportes disponibles para filtrar, según la última respuesta (CA2). */
  private readonly availableSports = signal<readonly Sport[]>([]);

  protected readonly sportOptions = computed(() => {
    const available = new Set(this.availableSports());
    const current = this.applied().sport;
    return SPORT_OPTIONS.filter((sport) => available.has(sport) || sport === current);
  });

  protected readonly selected = computed(
    () => this.sessions().find((session) => session.id === this.selectedId()) ?? null,
  );

  protected readonly notAuthorized = computed(() => {
    const state = this.state();
    return state.status === 'error' && state.error.code === ATHLETE_NOT_AUTHORIZED;
  });

  protected readonly emptyKey = computed(() =>
    hasFilters(this.applied())
      ? 'training.history.empty.filtered'
      : `training.history.empty.${this.scope.kind}`,
  );

  protected readonly durationText = durationText;

  /** Evita que una respuesta de una consulta anterior pise la vigente. */
  private generation = 0;
  private readonly formDirective = viewChild.required(FormGroupDirective);
  private readonly table = viewChild<ElementRef<HTMLElement>>('table');

  constructor() {
    void this.loadFirst();
  }

  protected applyFilters(): void {
    const value = this.form.getRawValue();
    this.applied.set({
      from: value.from || null,
      to: value.to || null,
      sport: value.sport,
    });
    void this.loadFirst();
  }

  protected clearFilters(): void {
    this.formDirective().resetForm({ from: '', to: '', sport: null });
    this.applied.set(NO_FILTERS);
    void this.loadFirst();
  }

  /** Primera página con los filtros vigentes; también es el reintento. */
  protected async loadFirst(): Promise<void> {
    const generation = ++this.generation;
    this.state.set(viewState.loading());
    this.sessions.set([]);
    this.nextCursor.set(null);
    this.moreError.set(null);
    this.selectedId.set(null);
    try {
      const page = await this.gateway.loadPage(this.scope, this.applied(), null);
      if (generation !== this.generation) {
        return;
      }
      this.availableSports.set(page.availableSports);
      this.sessions.set(page.sessions);
      this.nextCursor.set(page.nextCursor);
      this.state.set(
        viewState.fromData({ sessions: page.sessions }, (data) => data.sessions.length === 0),
      );
    } catch (error) {
      if (generation === this.generation) {
        this.state.set(viewState.fromError(error));
      }
    }
  }

  /** Página siguiente con el cursor tal como lo entregó el backend (CA4). */
  protected async loadMore(): Promise<void> {
    const cursor = this.nextCursor();
    if (cursor === null || this.loadingMore()) {
      return;
    }
    const generation = this.generation;
    const firstNew = this.sessions().length;
    this.loadingMore.set(true);
    this.moreError.set(null);
    try {
      const page = await this.gateway.loadPage(this.scope, this.applied(), cursor);
      if (generation !== this.generation) {
        return;
      }
      this.availableSports.set(page.availableSports);
      this.sessions.update((sessions) => [...sessions, ...page.sessions]);
      this.nextCursor.set(page.nextCursor);
      this.focusRow(firstNew);
    } catch (error) {
      if (generation === this.generation) {
        // Las sesiones ya cargadas se conservan; solo falla la página siguiente.
        this.moreError.set(toApiError(error));
      }
    } finally {
      if (generation === this.generation) {
        this.loadingMore.set(false);
      }
    }
  }

  protected toggleDetail(sessionId: string): void {
    this.selectedId.update((current) => (current === sessionId ? null : sessionId));
  }

  private resolveScope(): HistoryScope {
    const athleteId = this.route.snapshot.paramMap.get('athleteId');
    return athleteId === null ? { kind: 'own' } : { kind: 'athlete', athleteId };
  }

  /** Lleva el foco a la primera sesión agregada para seguir leyendo con teclado. */
  private focusRow(index: number): void {
    afterNextRender(
      () =>
        this.table()
          ?.nativeElement.querySelectorAll<HTMLElement>('tbody tr button')
          .item(index)
          ?.focus(),
      { injector: this.injector },
    );
  }
}
