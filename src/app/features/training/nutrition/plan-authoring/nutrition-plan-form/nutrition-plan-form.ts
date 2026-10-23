import {
  Component,
  DestroyRef,
  Injector,
  afterNextRender,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormArray,
  FormControl,
  FormGroup,
  FormGroupDirective,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { TranslatePipe } from '@ngx-translate/core';

import {
  NUTRITION_PLAN_LIMITS,
  QUANTITY_PATTERN,
} from '../../../../../core/api/bff-web/nutrition.api';
import {
  FoodCatalog,
  FoodUnit,
  MEAL_TYPE_OPTIONS,
  MealType,
  NutritionPlanDraft,
  NutritionPlanViolation,
  foodsByCategory,
} from '../../nutrition-plan.model';
import { NutritionFieldError } from '../nutrition-field-error/nutrition-field-error';
import { ViolationMessage, violationMessage, violationTarget } from '../nutrition-violations';

/** Rechazos del backend tras confirmar el plan. */
export interface NutritionPlanServerErrors {
  readonly violations: readonly NutritionPlanViolation[];
  /** Correo inexistente o deportista sin autorización (`athlete_authorization_required`). */
  readonly athleteNotAuthorized: boolean;
}

const LIMITS = NUTRITION_PLAN_LIMITS;
const QUANTITY = new RegExp(QUANTITY_PATTERN);

const notBlank = (control: AbstractControl<string>): ValidationErrors | null =>
  control.value && control.value.trim() === '' ? { required: true } : null;

/**
 * La cantidad viaja como cadena decimal con punto (`pattern` del contrato). Se
 * acepta también la coma decimal de la configuración regional y se normaliza al
 * enviar; el rango y la cantidad de decimales los decide el backend.
 */
export function normalizeQuantity(value: string): string {
  return value.trim().replace(',', '.');
}

const quantityFormat = (control: AbstractControl<string>): ValidationErrors | null => {
  const value = normalizeQuantity(control.value ?? '');
  return value === '' || QUANTITY.test(value) ? null : { pattern: true };
};

function objectiveControl(): FormControl<string> {
  return new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, notBlank, Validators.maxLength(LIMITS.objectiveMax)],
  });
}

function itemGroup() {
  return new FormGroup({
    foodCode: new FormControl<string | null>(null, { validators: [Validators.required] }),
    quantity: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(LIMITS.quantityMax), quantityFormat],
    }),
    unit: new FormControl<FoodUnit | null>(null, { validators: [Validators.required] }),
  });
}
type ItemGroup = ReturnType<typeof itemGroup>;

function mealGroup(items: ItemGroup[]) {
  return new FormGroup({
    mealType: new FormControl<MealType | null>(null, { validators: [Validators.required] }),
    items: new FormArray(items),
  });
}
type MealGroup = ReturnType<typeof mealGroup>;

/**
 * Editor de HU014: deportista (correo exacto), título, objetivos, periodo y el
 * menú diario con comidas y alimentos del catálogo cerrado. Solo aplica las
 * validaciones de experiencia derivadas del contrato (obligatorios, formato,
 * cantidades y longitudes). Las reglas del plan (periodo, catálogo, unidades,
 * rangos) y el bloqueo por alergias o restricciones los decide el backend y
 * llegan como `serverErrors`, marcados junto al ítem afectado (CA2).
 */
@Component({
  selector: 'app-nutrition-plan-form',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    NutritionFieldError,
    ReactiveFormsModule,
    TranslatePipe,
  ],
  templateUrl: './nutrition-plan-form.html',
  styleUrl: './nutrition-plan-form.scss',
})
export class NutritionPlanForm {
  readonly catalog = input.required<FoodCatalog>();
  readonly serverErrors = input<NutritionPlanServerErrors | null>(null);

  /** Los datos son válidos y el profesional pide revisarlos antes de asignar. */
  readonly reviewed = output<NutritionPlanDraft>();
  /** El profesional modificó los datos. */
  readonly edited = output();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly formDirective = viewChild.required(FormGroupDirective);

  protected readonly limits = LIMITS;
  protected readonly mealTypes = MEAL_TYPE_OPTIONS;
  protected readonly foodGroups = computed(() => foodsByCategory(this.catalog()));

  protected readonly form = new FormGroup({
    athleteEmail: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email, Validators.maxLength(LIMITS.emailMax)],
    }),
    title: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, notBlank, Validators.maxLength(LIMITS.titleMax)],
    }),
    objectives: new FormArray([objectiveControl()]),
    startDate: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    endDate: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    meals: new FormArray<MealGroup>([]),
  });

  /** Cantidades actuales, para habilitar agregar o quitar sin superar los límites. */
  protected readonly objectiveCount = signal(1);
  protected readonly mealCount = signal(0);

  protected readonly summary = computed<readonly ViolationMessage[]>(() =>
    (this.serverErrors()?.violations ?? []).map(violationMessage),
  );

  /** Controles marcados con un rechazo del backend en el último envío. */
  private serverMarked: AbstractControl[] = [];

  constructor() {
    this.form.controls.meals.push(this.newMeal(), { emitEvent: false });
    this.syncCounts();
    effect(() => this.applyServerErrors(this.serverErrors()));
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this.clearServerMarks();
      this.edited.emit();
    });
  }

  /** Vuelve al formulario inicial para crear otro plan. */
  reset(): void {
    this.objectives.clear({ emitEvent: false });
    this.objectives.push(objectiveControl(), { emitEvent: false });
    this.meals.clear({ emitEvent: false });
    this.meals.push(this.newMeal(), { emitEvent: false });
    // También reinicia el estado «enviado»: los campos vacíos no se marcan como error.
    this.formDirective().resetForm();
    this.syncCounts();
  }

  protected get objectives(): FormArray<FormControl<string>> {
    return this.form.controls.objectives;
  }

  protected get meals(): FormArray<MealGroup> {
    return this.form.controls.meals;
  }

  /** Unidades permitidas para el alimento elegido (`allowed_units` del catálogo). */
  protected unitsFor(item: ItemGroup): readonly FoodUnit[] {
    const code = item.controls.foodCode.value;
    return this.catalog().foods.find((food) => food.code === code)?.allowedUnits ?? [];
  }

  protected addObjective(): void {
    if (this.objectives.length < LIMITS.objectivesMax) {
      this.objectives.push(objectiveControl());
      this.syncCounts();
      this.focusLast('[data-focus="objective"]');
    }
  }

  protected removeObjective(index: number): void {
    if (this.objectives.length > LIMITS.objectivesMin) {
      this.objectives.removeAt(index);
      this.syncCounts();
    }
  }

  protected addMeal(): void {
    if (this.meals.length < LIMITS.mealsMax) {
      this.meals.push(this.newMeal());
      this.syncCounts();
      this.focusLast('[data-focus="meal"]');
    }
  }

  protected removeMeal(index: number): void {
    if (this.meals.length > LIMITS.mealsMin) {
      this.meals.removeAt(index);
      this.syncCounts();
    }
  }

  protected addItem(meal: number): void {
    const items = this.meals.at(meal).controls.items;
    if (items.length < LIMITS.itemsMax) {
      items.push(this.newItem());
      this.focusLast(`[data-meal="${meal}"] [data-focus="item"]`);
    }
  }

  protected removeItem(meal: number, item: number): void {
    const items = this.meals.at(meal).controls.items;
    if (items.length > LIMITS.itemsMin) {
      items.removeAt(item);
    }
  }

  protected review(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.focusFirstInvalid();
      return;
    }
    const value = this.form.getRawValue();
    this.reviewed.emit({
      athleteEmail: value.athleteEmail.trim(),
      title: value.title.trim(),
      objectives: value.objectives.map((objective) => objective.trim()),
      startDate: value.startDate,
      endDate: value.endDate,
      meals: value.meals.map((meal) => ({
        mealType: meal.mealType as MealType,
        items: meal.items.map((item) => ({
          foodCode: item.foodCode as string,
          quantity: normalizeQuantity(item.quantity),
          unit: item.unit as FoodUnit,
        })),
      })),
    });
  }

  private newMeal(): MealGroup {
    return mealGroup([this.newItem()]);
  }

  /** Al elegir un alimento se propone su unidad por defecto si la actual no está permitida. */
  private newItem(): ItemGroup {
    const item = itemGroup();
    item.controls.foodCode.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((code) => {
        const food = this.catalog().foods.find((option) => option.code === code);
        const unit = item.controls.unit.value;
        if (food && (unit === null || !food.allowedUnits.includes(unit))) {
          item.controls.unit.setValue(food.defaultUnit);
        }
      });
    return item;
  }

  private applyServerErrors(errors: NutritionPlanServerErrors | null): void {
    if (errors === null) {
      return;
    }
    if (errors.athleteNotAuthorized) {
      this.markServerError(this.form.controls.athleteEmail, { athleteNotAuthorized: true });
    }
    for (const violation of errors.violations) {
      const control = this.controlFor(violation.path);
      if (control) {
        const issues = (control.errors?.['nutritionRules'] as string[] | undefined) ?? [];
        this.markServerError(control, { nutritionRules: [...issues, violation.issue] });
      }
    }
    // El resumen de reglas incumplidas recibe el foco; sin él, el primer campo inválido.
    queueMicrotask(() => {
      const summary = this.host.nativeElement.querySelector<HTMLElement>(
        '[data-testid="nutrition-errors"]',
      );
      if (summary) {
        summary.focus();
      } else {
        this.focusFirstInvalid();
      }
    });
  }

  private controlFor(path: string): AbstractControl | null {
    const target = violationTarget(path);
    switch (target.control) {
      case null:
        return null;
      case 'objective':
        return this.objectives.at(target.index) ?? null;
      case 'mealType':
        return this.meals.at(target.meal)?.controls.mealType ?? null;
      case 'item':
        return (
          this.meals.at(target.meal)?.controls.items.at(target.item)?.controls[target.field] ?? null
        );
      default:
        return this.form.controls[target.control];
    }
  }

  private markServerError(control: AbstractControl, error: ValidationErrors): void {
    control.setErrors({ ...control.errors, ...error });
    control.markAsTouched();
    if (!this.serverMarked.includes(control)) {
      this.serverMarked.push(control);
    }
  }

  /**
   * Al editar cualquier dato se retiran las marcas del backend (cambiar un
   * alimento o el periodo puede resolverlas) y solo quedan las validaciones de
   * experiencia. El resumen del último envío sigue visible hasta el siguiente.
   */
  private clearServerMarks(): void {
    const marked = this.serverMarked;
    this.serverMarked = [];
    for (const control of marked) {
      control.updateValueAndValidity({ emitEvent: false });
    }
  }

  private syncCounts(): void {
    this.objectiveCount.set(this.objectives.length);
    this.mealCount.set(this.meals.length);
  }

  /** Lleva el foco al último elemento agregado, una vez que Angular lo dibuja. */
  private focusLast(selector: string): void {
    afterNextRender(
      () => {
        const elements = this.host.nativeElement.querySelectorAll<HTMLElement>(selector);
        elements.item(elements.length - 1)?.focus();
      },
      { injector: this.injector },
    );
  }

  private focusFirstInvalid(): void {
    queueMicrotask(() =>
      this.host.nativeElement
        .querySelector<HTMLElement>('input.ng-invalid, mat-select.ng-invalid')
        ?.focus(),
    );
  }
}
