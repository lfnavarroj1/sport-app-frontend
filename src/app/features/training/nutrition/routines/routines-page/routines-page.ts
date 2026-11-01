import { DatePipe, DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { TranslatePipe } from '@ngx-translate/core';

import { ApiError, toApiError } from '../../../../../core/api/api-error';
import {
  PUBLISH_ROUTINE_ERROR_CODES,
  RETIRE_ROUTINE_ERROR_CODES,
} from '../../../../../core/api/bff-web/nutrition-routines.api';
import { AsyncState } from '../../../../../shared/ui/async-state/async-state';
import { ViewState, viewState } from '../../../../../shared/ui/view-state';
import { FoodCatalog, foodLabelKey } from '../../nutrition-plan.model';
import { NutritionGateway } from '../../nutrition.gateway';
import { RoutineForm } from '../routine-form/routine-form';
import { RoutinesGateway } from '../routines.gateway';
import {
  NutritionRoutine,
  PublishOutcome,
  RetireOutcome,
  RoutineDraft,
  RoutineViolation,
  itemsCount,
  toPublishRoutineRequest,
} from '../routines.model';

/** Reintentos automáticos como máximo al publicar ante fallos transitorios. */
export const MAX_PUBLISH_RETRIES = 3;

interface RoutinesList {
  readonly routines: readonly NutritionRoutine[];
  readonly nextCursor: string | null;
}

/** Resultado del último retiro, por rutina. */
type RetireMessage =
  | { readonly kind: 'retired' }
  | { readonly kind: 'conflict'; readonly currentVersion: number | null }
  | { readonly kind: 'failed'; readonly error: ApiError };

/**
 * Rutinas de alimentación del profesional (HU030, ADR-041) en
 * `/profesional/alimentacion/plantillas`. Publica una rutina con alimentos del
 * catálogo de HU014 (`GET /v1/food-catalog`) e `Idempotency-Key` por intento
 * (misma clave en los reintentos), muestra la rutina y los alérgenos que
 * confirmó el backend (CA2), marca las reglas del `422` en su campo, comida o
 * alimento (CA4), lista las rutinas propias con «Cargar más» y retira una tras
 * confirmar, con la versión mostrada: un `409 version_conflict` no retira y
 * ofrece actualizar; una rutina ajena responde `404` (CA4). Publicar no asigna un
 * plan a nadie: la asignación es HU014.
 */
@Component({
  selector: 'app-routines-page',
  imports: [
    AsyncState,
    DatePipe,
    DecimalPipe,
    MatButtonModule,
    MatCardModule,
    RoutineForm,
    TranslatePipe,
  ],
  templateUrl: './routines-page.html',
  styleUrls: ['../../../training-page.scss', './routines-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RoutinesPage {
  private readonly gateway = inject(RoutinesGateway);
  private readonly nutrition = inject(NutritionGateway);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly state = signal<ViewState<RoutinesList>>(viewState.loading());
  protected readonly loadingMore = signal(false);
  protected readonly moreError = signal<ApiError | null>(null);

  /** Catálogo de alimentos para el formulario y los nombres de la lista. */
  protected readonly catalogState = signal<ViewState<FoodCatalog>>(viewState.loading());

  protected readonly composing = signal(false);
  protected readonly submitting = signal(false);
  protected readonly retryAttempt = signal<number | null>(null);
  protected readonly maxRetries = MAX_PUBLISH_RETRIES;
  protected readonly publishOutcome = signal<PublishOutcome | null>(null);

  /** Rutina con la confirmación de retiro abierta, o `null`. */
  protected readonly confirming = signal<string | null>(null);
  protected readonly retiring = signal<string | null>(null);
  protected readonly retireMessages = signal<ReadonlyMap<string, RetireMessage>>(new Map());

  protected readonly itemsCount = itemsCount;

  /** Solicitud y clave del intento de publicación en curso. */
  private pending: { readonly body: string; readonly key: string } | null = null;
  private generation = 0;
  private destroyed = false;

  protected readonly list = computed(() => {
    const state = this.state();
    return state.status === 'success' ? state.data : null;
  });

  protected readonly catalog = computed(() => {
    const state = this.catalogState();
    return state.status === 'success' ? state.data : null;
  });

  protected readonly published = computed(() => {
    const outcome = this.publishOutcome();
    return outcome?.kind === 'published' ? outcome : null;
  });

  protected readonly violations = computed<readonly RoutineViolation[] | null>(() => {
    const outcome = this.publishOutcome();
    return outcome?.kind === 'invalid' ? outcome.violations : null;
  });

  protected readonly publishFailure = computed<ApiError | null>(() => {
    const outcome = this.publishOutcome();
    return outcome?.kind === 'failed' ? outcome.error : null;
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
    void this.load();
    void this.loadCatalog();
  }

  /** Primera página de rutinas propias; también es el reintento y la actualización. */
  protected async load(): Promise<void> {
    const generation = ++this.generation;
    this.state.set(viewState.loading());
    this.loadingMore.set(false);
    this.moreError.set(null);
    this.confirming.set(null);
    this.retireMessages.set(new Map());
    try {
      const page = await this.gateway.loadRoutines(null);
      if (generation === this.generation && !this.destroyed) {
        this.state.set(
          viewState.fromData<RoutinesList>(page, (data) => data.routines.length === 0),
        );
      }
    } catch (error) {
      if (generation === this.generation && !this.destroyed) {
        this.state.set(viewState.fromError(error));
      }
    }
  }

  /** Catálogo cerrado de alimentos; un fallo se muestra con reintento, nunca como catálogo vacío. */
  protected async loadCatalog(): Promise<void> {
    this.catalogState.set(viewState.loading());
    try {
      const catalog = await this.nutrition.loadCatalog();
      if (!this.destroyed) {
        this.catalogState.set(viewState.fromData(catalog, (data) => data.foods.length === 0));
      }
    } catch (error) {
      if (!this.destroyed) {
        this.catalogState.set(viewState.fromError(error));
      }
    }
  }

  /** Página siguiente con el cursor del backend, sin modificarlo. */
  protected async loadMore(): Promise<void> {
    const current = this.list();
    if (current?.nextCursor == null || this.loadingMore()) {
      return;
    }
    const generation = this.generation;
    this.loadingMore.set(true);
    this.moreError.set(null);
    try {
      const next = await this.gateway.loadRoutines(current.nextCursor);
      if (generation === this.generation) {
        this.state.set({
          status: 'success',
          data: {
            routines: [...current.routines, ...next.routines],
            nextCursor: next.nextCursor,
          },
        });
      }
    } catch (error) {
      if (generation === this.generation) {
        this.moreError.set(toApiError(error));
      }
    } finally {
      if (generation === this.generation) {
        this.loadingMore.set(false);
      }
    }
  }

  protected compose(): void {
    this.composing.set(true);
    this.publishOutcome.set(null);
    this.pending = null;
  }

  protected cancelCompose(): void {
    this.composing.set(false);
    this.publishOutcome.set(null);
    this.pending = null;
  }

  /** El profesional cambió los datos: el siguiente envío es un intento nuevo. */
  protected onEdited(): void {
    this.pending = null;
  }

  protected async publish(draft: RoutineDraft): Promise<void> {
    if (this.submitting()) {
      return;
    }
    const key = this.keyFor(draft);
    this.submitting.set(true);
    this.retryAttempt.set(null);
    this.publishOutcome.set(null);
    let outcome: PublishOutcome;
    try {
      outcome = await this.gateway.publish(draft, key, (attempt) => this.retryAttempt.set(attempt));
    } catch (error) {
      outcome = { kind: 'failed', error: toApiError(error) };
    }
    if (this.destroyed) {
      return;
    }
    this.submitting.set(false);
    this.retryAttempt.set(null);
    this.publishOutcome.set(outcome);
    if (
      outcome.kind === 'published' ||
      (outcome.kind === 'failed' &&
        outcome.error.code === PUBLISH_ROUTINE_ERROR_CODES.idempotencyKeyReused)
    ) {
      this.pending = null;
    }
    if (outcome.kind === 'published') {
      this.composing.set(false);
      this.prepend(outcome.routine);
      this.focus('routine-published');
    } else if (outcome.kind === 'failed') {
      this.focus('routine-publish-error');
    }
  }

  protected askRetire(routine: NutritionRoutine): void {
    this.confirming.set(routine.id);
    this.focus(`routine-retire-confirm-${routine.id}`);
  }

  protected cancelRetire(): void {
    this.confirming.set(null);
  }

  protected async retire(routine: NutritionRoutine): Promise<void> {
    if (this.retiring() !== null) {
      return;
    }
    this.retiring.set(routine.id);
    let outcome: RetireOutcome;
    try {
      outcome = await this.gateway.retire(routine.id, routine.version);
    } catch (error) {
      outcome = { kind: 'failed', error: toApiError(error) };
    }
    if (this.destroyed) {
      return;
    }
    this.retiring.set(null);
    this.confirming.set(null);
    if (outcome.kind === 'retired') {
      this.replace(outcome.routine);
      this.setRetireMessage(routine.id, { kind: 'retired' });
    } else {
      this.setRetireMessage(routine.id, outcome);
    }
    this.focus(`routine-retire-message-${routine.id}`);
  }

  protected retireMessage(routineId: string): RetireMessage | null {
    return this.retireMessages().get(routineId) ?? null;
  }

  /** Error del último retiro de la rutina, si falló por algo distinto de un conflicto. */
  protected retireError(message: RetireMessage): ApiError | null {
    return message.kind === 'failed' ? message.error : null;
  }

  /** Clave i18n del nombre del alimento; `null` si el catálogo no está o no lo incluye. */
  protected foodLabel(code: string): string | null {
    return foodLabelKey(this.catalog(), code);
  }

  protected publishFailureMessage(error: ApiError): string {
    return error.code === PUBLISH_ROUTINE_ERROR_CODES.idempotencyKeyReused
      ? 'training.nutrition.routines.errors.idempotencyKeyReused'
      : `common.errors.${error.kind}`;
  }

  protected retireFailureMessage(error: ApiError): string {
    return error.code === RETIRE_ROUTINE_ERROR_CODES.templateNotFound
      ? 'training.nutrition.routines.errors.templateNotFound'
      : `common.errors.${error.kind}`;
  }

  /** Tras agotar los reintentos automáticos, reintentar no publica dos veces. */
  protected retryable(error: ApiError): boolean {
    return error.kind === 'offline' || error.kind === 'server';
  }

  /**
   * Agrega al principio la rutina recién publicada (la más reciente). Un
   * reintento idempotente devuelve una rutina que ya está en la lista: no se duplica.
   */
  private prepend(routine: NutritionRoutine): void {
    const current = this.list() ?? { routines: [], nextCursor: null };
    const others = current.routines.filter((item) => item.id !== routine.id);
    this.state.set({
      status: 'success',
      data: { ...current, routines: [routine, ...others] },
    });
  }

  /** Reemplaza en la lista la rutina que confirmó el retiro. */
  private replace(routine: NutritionRoutine): void {
    const current = this.list();
    if (current !== null) {
      const routines = current.routines.map((item) => (item.id === routine.id ? routine : item));
      this.state.set({ status: 'success', data: { ...current, routines } });
    }
  }

  private setRetireMessage(routineId: string, message: RetireMessage): void {
    const messages = new Map(this.retireMessages());
    messages.set(routineId, message);
    this.retireMessages.set(messages);
  }

  private keyFor(draft: RoutineDraft): string {
    const body = JSON.stringify(toPublishRoutineRequest(draft));
    if (this.pending?.body !== body) {
      this.pending = { body, key: crypto.randomUUID() };
    }
    return this.pending.key;
  }

  private focus(testId: string): void {
    afterNextRender(
      () =>
        this.host.nativeElement.querySelector<HTMLElement>(`[data-testid="${testId}"]`)?.focus(),
      { injector: this.injector },
    );
  }
}
