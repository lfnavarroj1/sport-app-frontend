import { DatePipe, DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  OnInit,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormControl, FormGroup, FormGroupDirective, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { TranslatePipe } from '@ngx-translate/core';

import { ApiError, toApiError } from '../../../../../core/api/api-error';
import { readErrorResponse } from '../../../../../core/api/bff-web/contract';
import {
  FOOD_INTAKES_ERROR_CODES,
  FOOD_INTAKES_ISSUES,
} from '../../../../../core/api/bff-web/food-intakes.api';
import { AsyncState } from '../../../../../shared/ui/async-state/async-state';
import { ViewState, viewState } from '../../../../../shared/ui/view-state';
import { FoodCatalog, MEAL_TYPE_OPTIONS, MealType } from '../../nutrition-plan.model';
import { FoodIntakesGateway } from '../food-intakes.gateway';
import {
  FoodIntake,
  IntakeFilters,
  IntakeScope,
  NO_INTAKE_FILTERS,
  foodLabelKey,
  groupByDay,
  hasIntakeFilters,
  periodIsInverted,
} from '../food-intakes.model';

/** Motivo de `422` que la sección sabe explicar (CA2). */
type IntakesIssue = 'toBeforeFrom' | 'invalidCursor';

/** Primera página cargada: base de la vista. */
interface LoadedIntakes {
  readonly intakes: readonly FoodIntake[];
}

/**
 * Historial de consumos de alimentos (HU013, ADR-037): los consumos registrados en
 * HU043, en el orden estable del backend (`consumed_at` e `intake_id`
 * descendentes), agrupados por día local y tipo de comida, con filtros por periodo
 * y tipo de comida y paginación por cursor («Cargar más»).
 *
 * Sirve al deportista (`scope: own`, en «Mi alimentación») y al profesional
 * autorizado (`athlete`). Los nombres de los alimentos salen del catálogo; si no
 * está disponible se muestra el código. Sin calorías, nutrientes ni juicios. La
 * autorización la decide el backend: un `403` se explica sin mostrar datos (CA3).
 */
@Component({
  selector: 'app-food-intake-history',
  imports: [
    AsyncState,
    DatePipe,
    DecimalPipe,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    ReactiveFormsModule,
    TranslatePipe,
  ],
  templateUrl: './food-intake-history.html',
  styleUrls: [
    '../../../training-page.scss',
    '../../nutrition-page.scss',
    './food-intake-history.scss',
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FoodIntakeHistory implements OnInit {
  private readonly gateway = inject(FoodIntakesGateway);
  private readonly injector = inject(Injector);

  readonly scope = input.required<IntakeScope>();
  /** Catálogo de alimentos; `null` mientras carga o si falló (se muestran los códigos). */
  readonly catalog = input<FoodCatalog | null>(null);
  /**
   * Resultado de la primera página sin filtros: `true` si no hay consumos. Permite
   * a «Mi alimentación» explicar que no hay consumos ni planes (CA5).
   */
  readonly unfilteredEmpty = output<boolean>();

  protected readonly mealTypes: readonly MealType[] = MEAL_TYPE_OPTIONS;

  protected readonly form = new FormGroup({
    from: new FormControl('', { nonNullable: true }),
    to: new FormControl('', { nonNullable: true }),
    mealType: new FormControl<MealType | null>(null),
  });

  /** Filtros de la consulta vigente (los del formulario al aplicarlos). */
  protected readonly applied = signal<IntakeFilters>(NO_INTAKE_FILTERS);
  protected readonly state = signal<ViewState<LoadedIntakes>>(viewState.loading());
  protected readonly intakes = signal<readonly FoodIntake[]>([]);
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly loadingMore = signal(false);
  protected readonly moreError = signal<ApiError | null>(null);
  /** Motivo de `422` de la última consulta (o del periodo invertido antes de enviar). */
  protected readonly issue = signal<IntakesIssue | null>(null);

  protected readonly days = computed(() => groupByDay(this.intakes()));

  protected readonly notAuthorized = computed(() => {
    const state = this.state();
    return (
      state.status === 'error' &&
      state.error.code === FOOD_INTAKES_ERROR_CODES.athleteAuthorizationRequired
    );
  });

  protected readonly emptyKey = computed(() =>
    hasIntakeFilters(this.applied())
      ? 'training.nutrition.intakes.empty.filtered'
      : `training.nutrition.intakes.empty.${this.scope().kind}`,
  );

  /** Evita que una respuesta de una consulta anterior pise la vigente. */
  private generation = 0;
  private readonly formDirective = viewChild.required(FormGroupDirective);
  private readonly list = viewChild<ElementRef<HTMLElement>>('list');

  ngOnInit(): void {
    void this.loadFirst();
  }

  protected foodKey(foodCode: string): string | null {
    return foodLabelKey(this.catalog(), foodCode);
  }

  protected applyFilters(): void {
    const value = this.form.getRawValue();
    const filters: IntakeFilters = {
      from: value.from || null,
      to: value.to || null,
      mealType: value.mealType,
    };
    if (periodIsInverted(filters)) {
      // Validación de experiencia: el mismo motivo que el `422 to_before_from`.
      this.issue.set('toBeforeFrom');
      return;
    }
    this.applied.set(filters);
    void this.loadFirst();
  }

  protected clearFilters(): void {
    this.formDirective().resetForm({ from: '', to: '', mealType: null });
    this.applied.set(NO_INTAKE_FILTERS);
    void this.loadFirst();
  }

  /** Primera página con los filtros vigentes; también es el reintento. */
  protected async loadFirst(): Promise<void> {
    const generation = ++this.generation;
    const filters = this.applied();
    this.state.set(viewState.loading());
    this.intakes.set([]);
    this.nextCursor.set(null);
    this.moreError.set(null);
    this.issue.set(null);
    // Una página siguiente en curso queda descartada: su `finally` ya no la libera.
    this.loadingMore.set(false);
    try {
      const page = await this.gateway.loadPage(this.scope(), filters, null);
      if (generation !== this.generation) {
        return;
      }
      this.intakes.set(page.intakes);
      this.nextCursor.set(page.nextCursor);
      this.state.set(
        viewState.fromData({ intakes: page.intakes }, (data) => data.intakes.length === 0),
      );
      if (!hasIntakeFilters(filters)) {
        this.unfilteredEmpty.emit(page.intakes.length === 0);
      }
    } catch (error) {
      if (generation === this.generation) {
        this.issue.set(issueOf(error));
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
    const firstNew = this.intakes().length;
    this.loadingMore.set(true);
    this.moreError.set(null);
    this.issue.set(null);
    try {
      const page = await this.gateway.loadPage(this.scope(), this.applied(), cursor);
      if (generation !== this.generation) {
        return;
      }
      this.intakes.update((intakes) => [...intakes, ...page.intakes]);
      this.nextCursor.set(page.nextCursor);
      this.focusIntake(firstNew);
    } catch (error) {
      if (generation === this.generation) {
        // Los consumos ya cargados se conservan; solo falla la página siguiente.
        this.issue.set(issueOf(error));
        this.moreError.set(toApiError(error));
      }
    } finally {
      if (generation === this.generation) {
        this.loadingMore.set(false);
      }
    }
  }

  /** Lleva el foco al primer consumo agregado para seguir leyendo con teclado. */
  private focusIntake(index: number): void {
    afterNextRender(
      () =>
        this.list()
          ?.nativeElement.querySelectorAll<HTMLElement>('[data-intake]')
          .item(index)
          ?.focus(),
      { injector: this.injector },
    );
  }
}

/** Motivo de `422 validation_error` documentado por el contrato, si lo es. */
function issueOf(error: unknown): IntakesIssue | null {
  if (!(error instanceof HttpErrorResponse) || error.status !== 422) {
    return null;
  }
  const details = readErrorResponse(error.error)?.details ?? [];
  const has = ({ field, issue }: { field: string; issue: string }) =>
    details.some((detail) => detail.field === field && detail.issue === issue);
  if (has(FOOD_INTAKES_ISSUES.toBeforeFrom)) {
    return 'toBeforeFrom';
  }
  if (has(FOOD_INTAKES_ISSUES.invalidCursor)) {
    return 'invalidCursor';
  }
  return null;
}
