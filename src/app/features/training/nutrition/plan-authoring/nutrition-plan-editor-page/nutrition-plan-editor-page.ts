import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { ApiError, toApiError } from '../../../../../core/api/api-error';
import { CREATE_NUTRITION_PLAN_ERROR_CODES } from '../../../../../core/api/bff-web/nutrition.api';
import { AsyncState } from '../../../../../shared/ui/async-state/async-state';
import { ViewState, viewState } from '../../../../../shared/ui/view-state';
import {
  CreateNutritionPlanOutcome,
  FoodCatalog,
  NutritionPlanDraft,
} from '../../nutrition-plan.model';
import { NutritionPlanSummary } from '../../nutrition-plan-summary/nutrition-plan-summary';
import { NutritionGateway } from '../../nutrition.gateway';
import {
  NutritionPlanForm,
  NutritionPlanServerErrors,
} from '../nutrition-plan-form/nutrition-plan-form';

const IDEMPOTENCY_KEY_REUSED = CREATE_NUTRITION_PLAN_ERROR_CODES.idempotencyKeyReused;

/** Paso del recorrido: editar, confirmar la asignación y ver el resultado. */
export type NutritionEditorStep = 'edit' | 'review' | 'done';

/**
 * Crear y asignar un plan de alimentación (HU014) para el profesional. El editor
 * se habilita con el catálogo cerrado de alimentos; el plan se revisa antes de
 * confirmarlo y solo se presenta como asignado con la respuesta del backend
 * (CA1), sin esperar la proyección. Un bloqueo por alergia o restricción llega
 * marcado en el ítem (CA2) y nada se guarda; el rechazo por permiso o
 * autorización (CA3) se informa sin datos. Si el deportista no registró hábitos,
 * el aviso del backend se muestra junto al resultado (CA6). Un reintento usa la
 * misma clave de idempotencia y no duplica el plan.
 */
@Component({
  selector: 'app-nutrition-plan-editor-page',
  imports: [
    AsyncState,
    DatePipe,
    MatButtonModule,
    MatCardModule,
    NutritionPlanForm,
    NutritionPlanSummary,
    RouterLink,
    TranslatePipe,
  ],
  templateUrl: './nutrition-plan-editor-page.html',
  styleUrls: ['../../../training-page.scss', '../../nutrition-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NutritionPlanEditorPage {
  private readonly gateway = inject(NutritionGateway);

  /**
   * Clave de idempotencia del intento lógico en curso: se conserva en los
   * reintentos y se descarta cuando cambian los datos, cuando el plan queda
   * asignado o cuando el BFF la rechaza por reutilizada.
   */
  private idempotencyKey: string | null = null;

  protected readonly catalogState = signal<ViewState<FoodCatalog>>(viewState.loading());
  protected readonly catalog = computed(() => {
    const state = this.catalogState();
    return state.status === 'success' ? state.data : null;
  });

  protected readonly step = signal<NutritionEditorStep>('edit');
  protected readonly draft = signal<NutritionPlanDraft | null>(null);
  protected readonly submitting = signal(false);
  private readonly outcome = signal<CreateNutritionPlanOutcome | null>(null);

  protected readonly created = computed(() => {
    const outcome = this.outcome();
    return outcome?.kind === 'created' ? outcome : null;
  });

  protected readonly failure = computed<ApiError | null>(() => {
    const outcome = this.outcome();
    return outcome?.kind === 'failed' ? outcome.error : null;
  });

  protected readonly serverErrors = computed<NutritionPlanServerErrors | null>(() => {
    const outcome = this.outcome();
    if (outcome?.kind === 'invalid') {
      return { violations: outcome.violations, athleteNotAuthorized: false };
    }
    if (outcome?.kind === 'athlete_not_authorized') {
      return { violations: [], athleteNotAuthorized: true };
    }
    return null;
  });

  private readonly form = viewChild(NutritionPlanForm);
  private readonly stepHeading = viewChild<ElementRef<HTMLElement>>('stepHeading');

  constructor() {
    // Cada cambio de paso lleva el foco a su encabezado (teclado y lectores de pantalla).
    effect(() => this.stepHeading()?.nativeElement.focus());
    void this.loadCatalog();
  }

  protected async loadCatalog(): Promise<void> {
    this.catalogState.set(viewState.loading());
    try {
      const catalog = await this.gateway.loadCatalog();
      this.catalogState.set(viewState.fromData(catalog, (data) => data.foods.length === 0));
    } catch (error) {
      this.catalogState.set(viewState.fromError(error));
    }
  }

  protected toReview(draft: NutritionPlanDraft): void {
    this.draft.set(draft);
    this.outcome.set(null);
    this.step.set('review');
  }

  protected backToEdit(): void {
    this.outcome.set(null);
    this.step.set('edit');
  }

  protected onEdited(): void {
    this.idempotencyKey = null;
  }

  protected async confirm(): Promise<void> {
    const draft = this.draft();
    if (this.submitting() || draft === null) {
      return;
    }
    this.idempotencyKey ??= crypto.randomUUID();
    this.submitting.set(true);

    let outcome: CreateNutritionPlanOutcome;
    try {
      outcome = await this.gateway.createPlan(draft, this.idempotencyKey);
    } catch (error) {
      outcome = { kind: 'failed', error: toApiError(error) };
    }
    this.submitting.set(false);

    if (
      outcome.kind === 'created' ||
      (outcome.kind === 'failed' && outcome.error.code === IDEMPOTENCY_KEY_REUSED)
    ) {
      this.idempotencyKey = null;
    }
    this.outcome.set(outcome);
    if (outcome.kind === 'created') {
      this.step.set('done');
    } else if (outcome.kind !== 'failed') {
      this.step.set('edit');
    }
  }

  protected createAnother(): void {
    this.form()?.reset();
    this.idempotencyKey = null;
    this.draft.set(null);
    this.outcome.set(null);
    this.step.set('edit');
  }

  protected failureMessage(error: ApiError): string {
    return error.code === IDEMPOTENCY_KEY_REUSED
      ? 'training.nutrition.errors.idempotencyKeyReused'
      : `common.errors.${error.kind}`;
  }
}
