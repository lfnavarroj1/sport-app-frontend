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
import { MatRadioModule } from '@angular/material/radio';
import { TranslatePipe } from '@ngx-translate/core';

import { ApiError, toApiError } from '../../../../core/api/api-error';
import { SUBSCRIPTION_CHANGE_ERROR_CODES } from '../../../../core/api/bff-web/affiliation.api';
import { SessionAccess, SessionAccessStore } from '../../../../core/session/session-access.store';
import { AsyncState } from '../../../../shared/ui/async-state/async-state';
import { ViewState, viewState } from '../../../../shared/ui/view-state';
import { MyPlanGateway } from '../my-plan.gateway';
import {
  ChangeOutcome,
  MyPlan,
  Periodicity,
  PlanChoice,
  PlanOffer,
  PlanOption,
  Subscription,
  canChoose,
  capabilityChanges,
  capabilityKey,
  choosablePeriodicities,
  formatCop,
  toChangeRequest,
} from '../my-plan.model';

const CODES = SUBSCRIPTION_CHANGE_ERROR_CODES;
/** Reintentos automáticos como máximo ante fallos transitorios (ADR-036, decisión 6). */
export const MAX_CHANGE_RETRIES = 3;

/** Mensaje propio de cada rechazo del cambio (HU016 CA2–CA4). */
const FAILURE_MESSAGES: Readonly<Record<string, string>> = {
  [CODES.versionConflict]: 'affiliation.myPlan.errors.versionConflict',
  [CODES.subscriptionUnchanged]: 'affiliation.myPlan.errors.subscriptionUnchanged',
  [CODES.subscriptionProvisioning]: 'affiliation.myPlan.errors.subscriptionProvisioning',
  [CODES.planNotSelectable]: 'affiliation.myPlan.errors.planNotSelectable',
  [CODES.planNotFound]: 'affiliation.myPlan.errors.planNotFound',
  [CODES.idempotencyKeyReused]: 'affiliation.myPlan.errors.idempotencyKeyReused',
};

/** Rechazos que se resuelven volviendo a consultar el plan vigente. */
const RELOAD_CODES: readonly string[] = [
  CODES.versionConflict,
  CODES.subscriptionProvisioning,
  CODES.planNotSelectable,
  CODES.planNotFound,
];

type Step = 'choose' | 'confirm';

interface Selection {
  readonly plan: PlanOption;
  readonly periodicity: Periodicity | null;
}

type MenuStatus = 'updating' | 'updated' | 'failed';

/**
 * «Mi plan» del deportista (HU016, ADR-036) en `/deportista/plan`: plan actual,
 * comparación de los planes por capacidades (propias y heredadas por nivel) y
 * ofertas, elección de plan y periodicidad, confirmación con el aviso de no
 * cobro y resultado confirmado por el BFF. Tras el `200` se vuelven a consultar
 * las capacidades (`GET /v1/me/capabilities`) y el menú se reconstruye sin
 * cerrar la sesión (CA8). La `Idempotency-Key` es la misma mientras no cambie la
 * solicitud (reintentos automáticos y manuales) y se renueva tras el éxito o ante
 * `idempotency_key_reused`. El catálogo y la suscripción viven solo en memoria.
 */
@Component({
  selector: 'app-my-plan-page',
  imports: [AsyncState, DatePipe, MatButtonModule, MatCardModule, MatRadioModule, TranslatePipe],
  templateUrl: './my-plan-page.html',
  styleUrl: './my-plan-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MyPlanPage {
  private readonly gateway = inject(MyPlanGateway);
  private readonly access = inject(SessionAccessStore);
  private readonly injector = inject(Injector);

  protected readonly state = signal<ViewState<MyPlan>>(viewState.loading());
  protected readonly selection = signal<Selection | null>(null);
  protected readonly step = signal<Step>('choose');
  protected readonly periodicityMissing = signal(false);
  protected readonly submitting = signal(false);
  /** Reintento automático en curso (1 a 3), o `null`. */
  protected readonly retryAttempt = signal<number | null>(null);
  protected readonly maxRetries = MAX_CHANGE_RETRIES;
  private readonly outcome = signal<ChangeOutcome | null>(null);
  /** Vista de capacidades anterior a la nueva consulta; `undefined` si no se pidió. */
  private readonly accessBefore = signal<ViewState<SessionAccess> | null | undefined>(undefined);

  /** Solicitud y clave del intento lógico en curso. */
  private pending: { readonly body: string; readonly key: string } | null = null;
  private generation = 0;

  protected readonly plan = computed(() => {
    const state = this.state();
    return state.status === 'success' ? state.data : null;
  });

  protected readonly provisioning = computed(
    () => this.plan()?.subscription.status === 'PROVISIONING',
  );

  protected readonly currentPlan = computed<PlanOption | null>(() => {
    const plan = this.plan();
    const code = plan?.subscription.planCode ?? null;
    return plan?.catalog.plans.find((option) => option.code === code) ?? null;
  });

  protected readonly changed = computed(() => {
    const outcome = this.outcome();
    return outcome?.kind === 'changed' ? outcome : null;
  });

  protected readonly failure = computed<ApiError | null>(() => {
    const outcome = this.outcome();
    return outcome?.kind === 'failed' ? outcome.error : null;
  });

  protected readonly invalid = computed(() => this.outcome()?.kind === 'invalid');

  protected readonly changes = computed(() => {
    const selection = this.selection();
    return selection ? capabilityChanges(this.currentPlan(), selection.plan) : null;
  });

  protected readonly selectedOffer = computed<PlanOffer | null>(() => {
    const selection = this.selection();
    return (
      selection?.plan.offers.find((offer) => offer.periodicity === selection.periodicity) ?? null
    );
  });

  protected readonly menuStatus = computed<MenuStatus | null>(() => {
    const before = this.accessBefore();
    if (before === undefined) {
      return null;
    }
    const view = this.access.view();
    if (view === before || view?.status === 'loading') {
      return 'updating';
    }
    return view?.status === 'success' ? 'updated' : 'failed';
  });

  private readonly selectionHeading = viewChild<ElementRef<HTMLElement>>('selectionHeading');
  private readonly confirmHeading = viewChild<ElementRef<HTMLElement>>('confirmHeading');
  private readonly resultHeading = viewChild<ElementRef<HTMLElement>>('resultHeading');
  private readonly failureAlert = viewChild<ElementRef<HTMLElement>>('failureAlert');

  constructor() {
    void this.load();
  }

  /** Consulta el catálogo y la suscripción; también es el reintento y la recarga. */
  protected async load(): Promise<void> {
    const generation = ++this.generation;
    this.state.set(viewState.loading());
    this.selection.set(null);
    this.step.set('choose');
    this.outcome.set(null);
    this.pending = null;
    try {
      const plan = await this.gateway.load();
      if (generation === this.generation) {
        this.state.set({ status: 'success', data: plan });
      }
    } catch (error) {
      if (generation === this.generation) {
        this.state.set(viewState.fromError(error));
      }
    }
  }

  protected isCurrent(plan: PlanOption): boolean {
    return this.plan()?.subscription.planCode === plan.code;
  }

  protected choosable(plan: PlanOption): boolean {
    const data = this.plan();
    return data !== null && canChoose(plan, data.subscription);
  }

  protected periodicities(plan: PlanOption): Periodicity[] {
    return choosablePeriodicities(plan);
  }

  protected offerFor(plan: PlanOption, periodicity: Periodicity): PlanOffer | null {
    return plan.offers.find((offer) => offer.periodicity === periodicity) ?? null;
  }

  /** La periodicidad vigente del plan actual no se ofrece: no sería un cambio. */
  protected isCurrentOffer(plan: PlanOption, periodicity: Periodicity): boolean {
    const subscription = this.plan()?.subscription;
    return subscription?.planCode === plan.code && subscription.periodicity === periodicity;
  }

  protected choose(plan: PlanOption): void {
    const periodicities = this.periodicities(plan);
    this.selection.set({
      plan,
      // Un plan sin costo tiene una sola periodicidad (`NONE`): no se pregunta.
      periodicity: plan.paid ? null : (periodicities[0] ?? null),
    });
    this.step.set('choose');
    this.periodicityMissing.set(false);
    this.outcome.set(null);
    this.focus(this.selectionHeading);
  }

  protected selectPeriodicity(periodicity: Periodicity): void {
    const selection = this.selection();
    if (selection) {
      this.selection.set({ ...selection, periodicity });
      this.periodicityMissing.set(false);
    }
  }

  protected continueToConfirm(): void {
    if (this.selection()?.periodicity == null) {
      this.periodicityMissing.set(true);
      return;
    }
    this.step.set('confirm');
    this.focus(this.confirmHeading);
  }

  protected back(): void {
    this.step.set('choose');
    this.outcome.set(null);
    this.focus(this.selectionHeading);
  }

  protected cancel(): void {
    this.selection.set(null);
    this.step.set('choose');
    this.outcome.set(null);
  }

  protected async confirm(): Promise<void> {
    const selection = this.selection();
    const data = this.plan();
    const version = data?.subscription.version ?? null;
    if (data === null || selection?.periodicity == null || version === null || this.submitting()) {
      return;
    }
    const choice: PlanChoice = {
      planCode: selection.plan.code,
      periodicity: selection.periodicity,
      expectedVersion: version,
    };
    const key = this.keyFor(choice);
    // Mientras se envía no hay forma de recargar el plan: el resultado corresponde a `data`.
    this.submitting.set(true);
    this.retryAttempt.set(null);
    this.outcome.set(null);

    let outcome: ChangeOutcome;
    try {
      outcome = await this.gateway.change(choice, key, (attempt) => this.retryAttempt.set(attempt));
    } catch (error) {
      outcome = { kind: 'failed', error: toApiError(error) };
    }
    this.submitting.set(false);
    this.retryAttempt.set(null);

    if (
      outcome.kind === 'changed' ||
      (outcome.kind === 'failed' && outcome.error.code === CODES.idempotencyKeyReused)
    ) {
      this.pending = null;
    }
    this.outcome.set(outcome);
    if (outcome.kind === 'changed') {
      this.applyChange(data, outcome.subscription);
      this.focus(this.resultHeading);
    } else {
      this.focus(this.failureAlert);
    }
  }

  protected failureMessage(error: ApiError): string {
    return (error.code && FAILURE_MESSAGES[error.code]) ?? `common.errors.${error.kind}`;
  }

  /** El rechazo se resuelve con el plan vigente: se ofrece recargar. */
  protected needsReload(error: ApiError): boolean {
    return error.code !== null && RELOAD_CODES.includes(error.code);
  }

  /** Tras agotar los reintentos automáticos, reintentar no cambia el plan dos veces. */
  protected retryable(error: ApiError): boolean {
    return error.kind === 'offline' || error.kind === 'server';
  }

  protected capabilityKey(code: string): string | null {
    return capabilityKey(code);
  }

  protected price(amount: string): string {
    return formatCop(amount);
  }

  protected planName(code: string | null): string | null {
    return this.plan()?.catalog.plans.find((option) => option.code === code)?.name ?? code;
  }

  /** Refleja la suscripción confirmada y vuelve a consultar las capacidades (CA8). */
  private applyChange(data: MyPlan, subscription: Subscription): void {
    this.state.set({
      status: 'success',
      data: {
        catalog: { ...data.catalog, currentPlanCode: subscription.planCode },
        subscription,
      },
    });
    this.selection.set(null);
    this.step.set('choose');
    this.accessBefore.set(this.access.view());
    this.access.reload();
  }

  private keyFor(choice: PlanChoice): string {
    const body = JSON.stringify(toChangeRequest(choice));
    if (this.pending?.body !== body) {
      this.pending = { body, key: crypto.randomUUID() };
    }
    return this.pending.key;
  }

  private focus(target: () => ElementRef<HTMLElement> | undefined): void {
    afterNextRender(() => target()?.nativeElement.focus(), { injector: this.injector });
  }
}
