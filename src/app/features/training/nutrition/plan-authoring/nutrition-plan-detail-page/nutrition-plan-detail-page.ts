import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { GET_NUTRITION_PLAN_ERROR_CODES } from '../../../../../core/api/bff-web/nutrition.api';
import { AsyncState } from '../../../../../shared/ui/async-state/async-state';
import { ViewState, viewState } from '../../../../../shared/ui/view-state';
import { FoodCatalog, NutritionPlan } from '../../nutrition-plan.model';
import { NutritionPlanSummary } from '../../nutrition-plan-summary/nutrition-plan-summary';
import { NutritionGateway } from '../../nutrition.gateway';

/**
 * Consulta de un plan de alimentación creado por el profesional (HU014 CA3–CA5).
 * La lectura es eventual: justo después de crearlo el BFF puede responder `404
 * nutrition_plan_not_found` mientras se proyecta, igual que para un plan ajeno;
 * la pantalla lo explica y permite reintentar. Si el deportista revocó la
 * autorización, el `403 athlete_authorization_required` se muestra sin datos.
 */
@Component({
  selector: 'app-nutrition-plan-detail-page',
  imports: [
    AsyncState,
    DatePipe,
    MatButtonModule,
    MatCardModule,
    NutritionPlanSummary,
    RouterLink,
    TranslatePipe,
  ],
  templateUrl: './nutrition-plan-detail-page.html',
  styleUrls: ['../../../training-page.scss', '../../nutrition-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NutritionPlanDetailPage {
  private readonly gateway = inject(NutritionGateway);
  private readonly planId = inject(ActivatedRoute).snapshot.paramMap.get('planId') ?? '';

  protected readonly state = signal<ViewState<NutritionPlan>>(viewState.loading());
  /** Nombres de los alimentos; si el catálogo falla se muestran los códigos. */
  protected readonly catalog = signal<FoodCatalog | null>(null);
  protected readonly plan = computed(() => {
    const state = this.state();
    return state.status === 'success' ? state.data : null;
  });
  protected readonly notFound = computed(() => {
    const state = this.state();
    return state.status === 'error' && state.error.kind === 'not_found';
  });
  protected readonly authorizationRevoked = computed(() => {
    const state = this.state();
    return (
      state.status === 'error' &&
      state.error.code === GET_NUTRITION_PLAN_ERROR_CODES.athleteAuthorizationRequired
    );
  });

  constructor() {
    void this.load();
    void this.gateway.loadCatalog().then(
      (catalog) => this.catalog.set(catalog),
      () => this.catalog.set(null),
    );
  }

  protected async load(): Promise<void> {
    this.state.set(viewState.loading());
    try {
      this.state.set(viewState.fromData(await this.gateway.getPlan(this.planId)));
    } catch (error) {
      this.state.set(viewState.fromError(error));
    }
  }
}
