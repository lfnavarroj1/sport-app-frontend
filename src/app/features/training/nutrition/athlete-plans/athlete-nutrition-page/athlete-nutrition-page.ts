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
import { MatExpansionModule } from '@angular/material/expansion';
import { TranslatePipe } from '@ngx-translate/core';

import { ApiError, toApiError } from '../../../../../core/api/api-error';
import { AsyncState } from '../../../../../shared/ui/async-state/async-state';
import { ViewState, viewState } from '../../../../../shared/ui/view-state';
import { FoodCatalog, NutritionPlan } from '../../nutrition-plan.model';
import { NutritionPlanSummary } from '../../nutrition-plan-summary/nutrition-plan-summary';
import { NutritionGateway } from '../../nutrition.gateway';

/** Primera página cargada: base de la vista. */
interface LoadedPlans {
  readonly plans: readonly NutritionPlan[];
}

/**
 * «Mi alimentación» del deportista (`/deportista/alimentacion`), sección «Planes
 * de alimentación» de HU014 (CA5): los planes asignados una vez proyectados, en
 * el orden del backend (`created_at` y `plan_id` descendentes), con paginación
 * por cursor. Muestra el estado confirmado y el menú del profesional, sin
 * calorías, nutrientes ni juicios (ADR-037). Los consumos de HU013 serán otra
 * sección de esta misma pantalla.
 */
@Component({
  selector: 'app-athlete-nutrition-page',
  imports: [
    AsyncState,
    DatePipe,
    MatButtonModule,
    MatCardModule,
    MatExpansionModule,
    NutritionPlanSummary,
    TranslatePipe,
  ],
  templateUrl: './athlete-nutrition-page.html',
  styleUrls: ['../../../training-page.scss', '../../nutrition-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AthleteNutritionPage {
  private readonly gateway = inject(NutritionGateway);
  private readonly injector = inject(Injector);

  protected readonly state = signal<ViewState<LoadedPlans>>(viewState.loading());
  protected readonly plans = signal<readonly NutritionPlan[]>([]);
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly loadingMore = signal(false);
  protected readonly moreError = signal<ApiError | null>(null);
  /** Nombres de los alimentos; si el catálogo falla se muestran los códigos. */
  protected readonly catalog = signal<FoodCatalog | null>(null);

  /** Evita que una respuesta de una carga anterior pise la vigente. */
  private generation = 0;
  private readonly list = viewChild<ElementRef<HTMLElement>>('list');

  constructor() {
    void this.loadFirst();
    void this.gateway.loadCatalog().then(
      (catalog) => this.catalog.set(catalog),
      () => this.catalog.set(null),
    );
  }

  /** Primera página; también es el reintento. */
  protected async loadFirst(): Promise<void> {
    const generation = ++this.generation;
    this.state.set(viewState.loading());
    this.plans.set([]);
    this.nextCursor.set(null);
    this.moreError.set(null);
    // Una página siguiente en curso queda descartada: su `finally` ya no la libera.
    this.loadingMore.set(false);
    try {
      const page = await this.gateway.loadMyPlans(null);
      if (generation !== this.generation) {
        return;
      }
      this.plans.set(page.plans);
      this.nextCursor.set(page.nextCursor);
      this.state.set(viewState.fromData({ plans: page.plans }, (data) => data.plans.length === 0));
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
    const firstNew = this.plans().length;
    this.loadingMore.set(true);
    this.moreError.set(null);
    try {
      const page = await this.gateway.loadMyPlans(cursor);
      if (generation !== this.generation) {
        return;
      }
      this.plans.update((plans) => [...plans, ...page.plans]);
      this.nextCursor.set(page.nextCursor);
      this.focusPlan(firstNew);
    } catch (error) {
      if (generation === this.generation) {
        // Los planes ya cargados se conservan; solo falla la página siguiente.
        this.moreError.set(toApiError(error));
      }
    } finally {
      if (generation === this.generation) {
        this.loadingMore.set(false);
      }
    }
  }

  /** Lleva el foco al encabezado del primer plan agregado para seguir con el teclado. */
  private focusPlan(index: number): void {
    afterNextRender(
      () =>
        this.list()
          ?.nativeElement.querySelectorAll<HTMLElement>('mat-expansion-panel-header')
          .item(index)
          ?.focus(),
      { injector: this.injector },
    );
  }
}
