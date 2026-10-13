import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { AsyncState } from '../../../../shared/ui/async-state/async-state';
import { ViewState, viewState } from '../../../../shared/ui/view-state';
import { PlanSummary } from '../../plan-summary/plan-summary';
import { TrainingPlan } from '../../training-plan.model';
import { PlanAuthoringGateway } from '../plan-authoring.gateway';

/**
 * Consulta de un plan creado (HU010 CA4). La lectura es eventual: justo después
 * de crearlo el BFF puede responder `404 training_plan_not_found` mientras se
 * proyecta, igual que para un plan inexistente o ajeno; la pantalla lo explica y
 * permite reintentar, sin presentarlo como un plan vacío.
 */
@Component({
  selector: 'app-plan-detail-page',
  imports: [
    AsyncState,
    DatePipe,
    MatButtonModule,
    MatCardModule,
    PlanSummary,
    RouterLink,
    TranslatePipe,
  ],
  templateUrl: './plan-detail-page.html',
  styleUrl: '../../training-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlanDetailPage {
  private readonly gateway = inject(PlanAuthoringGateway);
  private readonly planId = inject(ActivatedRoute).snapshot.paramMap.get('planId') ?? '';

  protected readonly state = signal<ViewState<TrainingPlan>>(viewState.loading());
  protected readonly plan = computed(() => {
    const state = this.state();
    return state.status === 'success' ? state.data : null;
  });
  protected readonly notFound = computed(() => {
    const state = this.state();
    return state.status === 'error' && state.error.kind === 'not_found';
  });

  constructor() {
    void this.load();
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
