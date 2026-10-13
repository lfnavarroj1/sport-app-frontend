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

import { ApiError, toApiError } from '../../../../core/api/api-error';
import { CREATE_TRAINING_PLAN_ERROR_CODES } from '../../../../core/api/bff-web/training.api';
import { PlanSummary } from '../../plan-summary/plan-summary';
import { PlanAuthoringGateway } from '../plan-authoring.gateway';
import { CreatePlanOutcome, PlanDraft } from '../plan-authoring.model';
import { PlanForm, PlanServerErrors } from '../plan-form/plan-form';

const IDEMPOTENCY_KEY_REUSED = CREATE_TRAINING_PLAN_ERROR_CODES.idempotencyKeyReused;

/** Paso del recorrido: editar, confirmar la asignación y ver el resultado. */
export type EditorStep = 'edit' | 'review' | 'done';

/**
 * Crear y asignar un plan de entrenamiento (HU010) para el profesional. El plan
 * se revisa antes de confirmarlo y solo se presenta como asignado con la
 * respuesta del backend (CA1). El rechazo por rol o autorización (CA2) y las
 * reglas incumplidas (CA3) se informan sin guardar nada; un reintento usa la
 * misma clave de idempotencia y no duplica el plan (CA5).
 */
@Component({
  selector: 'app-plan-editor-page',
  imports: [
    DatePipe,
    MatButtonModule,
    MatCardModule,
    PlanForm,
    PlanSummary,
    RouterLink,
    TranslatePipe,
  ],
  templateUrl: './plan-editor-page.html',
  styleUrl: '../../training-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlanEditorPage {
  private readonly gateway = inject(PlanAuthoringGateway);

  /**
   * Clave de idempotencia del intento lógico en curso: se conserva en los
   * reintentos y se descarta cuando cambian los datos, cuando el plan queda
   * asignado o cuando el BFF la rechaza por reutilizada (CA5).
   */
  private idempotencyKey: string | null = null;

  protected readonly step = signal<EditorStep>('edit');
  protected readonly draft = signal<PlanDraft | null>(null);
  protected readonly submitting = signal(false);
  private readonly outcome = signal<CreatePlanOutcome | null>(null);

  protected readonly created = computed(() => {
    const outcome = this.outcome();
    return outcome?.kind === 'created' ? outcome : null;
  });

  protected readonly failure = computed<ApiError | null>(() => {
    const outcome = this.outcome();
    return outcome?.kind === 'failed' ? outcome.error : null;
  });

  protected readonly serverErrors = computed<PlanServerErrors | null>(() => {
    const outcome = this.outcome();
    if (outcome?.kind === 'invalid') {
      return { violations: outcome.violations, athleteNotAuthorized: false };
    }
    if (outcome?.kind === 'athlete_not_authorized') {
      return { violations: [], athleteNotAuthorized: true };
    }
    return null;
  });

  private readonly form = viewChild.required(PlanForm);
  private readonly stepHeading = viewChild<ElementRef<HTMLElement>>('stepHeading');

  constructor() {
    // Cada cambio de paso lleva el foco a su encabezado (teclado y lectores de pantalla).
    effect(() => this.stepHeading()?.nativeElement.focus());
  }

  protected toReview(draft: PlanDraft): void {
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

    let outcome: CreatePlanOutcome;
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
    this.form().reset();
    this.idempotencyKey = null;
    this.draft.set(null);
    this.outcome.set(null);
    this.step.set('edit');
  }

  protected failureMessage(error: ApiError): string {
    return error.code === IDEMPOTENCY_KEY_REUSED
      ? 'training.plan.errors.idempotencyKeyReused'
      : `common.errors.${error.kind}`;
  }
}
