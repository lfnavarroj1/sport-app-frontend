import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormArray,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { TranslatePipe } from '@ngx-translate/core';

import {
  ROUTINE_ALLERGENS,
  ROUTINE_DIET_PATTERNS,
  ROUTINE_GOALS,
  ROUTINE_LIMITS,
  ROUTINE_MEAL_TYPES,
  ROUTINE_SPORTS,
} from '../../../../../core/api/bff-web/nutrition-routines.api';
import { FoodCatalog, foodsByCategory } from '../../nutrition-plan.model';
import {
  RoutineAllergen,
  RoutineDietPattern,
  RoutineDraft,
  RoutineGoal,
  RoutineMealType,
  RoutineSport,
  RoutineViolation,
  routineFieldText,
  routineIssueKey,
  routineTarget,
} from '../routines.model';
import { RoutineFieldError } from './routine-field-error';

const LIMITS = ROUTINE_LIMITS;

/** Texto recortado con la longitud del contrato (el servicio también recorta). */
function trimmedLength(min: number, max: number) {
  return (control: AbstractControl<string>): ValidationErrors | null => {
    const value = (control.value ?? '').trim();
    if (value === '') {
      return { required: true };
    }
    if (value.length < min) {
      return { minlength: { requiredLength: min, actualLength: value.length } };
    }
    return value.length > max
      ? { maxlength: { requiredLength: max, actualLength: value.length } }
      : null;
  };
}

const integer = (control: AbstractControl<number | null>): ValidationErrors | null =>
  control.value !== null && !Number.isInteger(control.value) ? { integer: true } : null;

function wholeNumber(min: number, max: number, initial: number | null = null) {
  return new FormControl<number | null>(initial, {
    validators: [Validators.required, integer, Validators.min(min), Validators.max(max)],
  });
}

function item() {
  return new FormGroup({
    foodCode: new FormControl<string | null>(null, { validators: [Validators.required] }),
    portions: wholeNumber(LIMITS.portionsMin, LIMITS.portionsMax, 1),
  });
}
type ItemGroup = ReturnType<typeof item>;

function meal() {
  return new FormGroup({
    meal: new FormControl<RoutineMealType | null>(null, { validators: [Validators.required] }),
    items: new FormArray<ItemGroup>([item()]),
  });
}
type MealGroup = ReturnType<typeof meal>;

function allergenChecks() {
  return new FormGroup(
    Object.fromEntries(
      ROUTINE_ALLERGENS.map((allergen) => [
        allergen,
        new FormControl(false, { nonNullable: true }),
      ]),
    ) as Record<RoutineAllergen, FormControl<boolean>>,
  );
}

/**
 * Formulario para publicar una rutina de alimentación (HU030, ADR-041): título,
 * descripción, objetivo de ADR-034, deporte opcional de HU010, patrón
 * alimenticio y alérgenos que contiene (catálogos de HU009), vigencia en días y
 * de 1 a 8 comidas de un día tipo, cada una con 1 a 15 alimentos del catálogo de
 * HU014 y sus porciones, en el orden del profesional. No tiene deportista ni
 * fechas: no es un plan asignado (HU014). Solo se validan las restricciones del
 * contrato; la existencia de cada alimento, su coherencia con el patrón y los
 * alérgenos que aporta los decide el servicio y llegan en `details`, que se
 * marcan en su campo, comida o alimento (CA2 y CA4).
 */
@Component({
  selector: 'app-routine-form',
  imports: [
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    ReactiveFormsModule,
    RoutineFieldError,
    TranslatePipe,
  ],
  templateUrl: './routine-form.html',
  styleUrl: './routine-form.scss',
})
export class RoutineForm {
  readonly catalog = input.required<FoodCatalog>();
  readonly submitting = input(false);
  readonly serverErrors = input<readonly RoutineViolation[] | null>(null);

  readonly submitted = output<RoutineDraft>();
  /** El profesional modificó los datos. */
  readonly edited = output();
  readonly cancelled = output();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly limits = LIMITS;
  protected readonly goals = ROUTINE_GOALS;
  protected readonly sports = ROUTINE_SPORTS;
  protected readonly patterns = ROUTINE_DIET_PATTERNS;
  protected readonly allergens = ROUTINE_ALLERGENS;
  protected readonly mealTypes = ROUTINE_MEAL_TYPES;

  protected readonly form = new FormGroup({
    title: new FormControl('', {
      nonNullable: true,
      validators: [trimmedLength(LIMITS.titleMin, LIMITS.titleMax)],
    }),
    description: new FormControl('', {
      nonNullable: true,
      validators: [trimmedLength(LIMITS.descriptionMin, LIMITS.descriptionMax)],
    }),
    goal: new FormControl<RoutineGoal | null>(null, { validators: [Validators.required] }),
    /** Opcional: `null` es «sin deporte». */
    sport: new FormControl<RoutineSport | null>(null),
    dietaryPattern: new FormControl<RoutineDietPattern | null>(null, {
      validators: [Validators.required],
    }),
    containsAllergens: allergenChecks(),
    durationDays: wholeNumber(LIMITS.daysMin, LIMITS.daysMax),
    dailyMeals: new FormArray<MealGroup>([meal()]),
  });

  protected readonly meals = this.form.controls.dailyMeals;
  protected readonly mealCount = signal(1);
  protected readonly canAddMeal = computed(() => this.mealCount() < LIMITS.mealsMax);
  protected readonly canRemoveMeal = computed(() => this.mealCount() > LIMITS.mealsMin);
  protected readonly foodGroups = computed(() => foodsByCategory(this.catalog()));

  /** Regla del backend sobre la lista de alérgenos (`contains_allergens`), o `null`. */
  protected readonly allergensRule = signal<string | null>(null);
  /** Reglas del backend sobre una comida completa o su lista de alimentos, por posición. */
  protected readonly mealRules = signal<ReadonlyMap<number, string>>(new Map());

  /** Resumen de las reglas que informó el backend en el último envío. */
  protected readonly summary = computed(() =>
    (this.serverErrors() ?? []).map((violation) => ({
      field: routineFieldText(violation.field),
      issue: routineIssueKey(violation.issue),
    })),
  );

  private serverMarked: AbstractControl[] = [];

  constructor() {
    effect(() => this.applyServerErrors(this.serverErrors()));
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this.clearServerMarks();
      this.edited.emit();
    });
  }

  protected itemsOf(index: number): FormArray<ItemGroup> {
    return this.meals.at(index).controls.items;
  }

  protected addMeal(): void {
    if (!this.canAddMeal()) {
      return;
    }
    this.meals.push(meal());
    this.mealCount.set(this.meals.length);
    this.focusLast('[data-meal] mat-select[formcontrolname="meal"]');
  }

  protected removeMeal(index: number): void {
    if (!this.canRemoveMeal()) {
      return;
    }
    this.meals.removeAt(index);
    this.mealCount.set(this.meals.length);
  }

  protected addItem(mealIndex: number): void {
    const items = this.itemsOf(mealIndex);
    if (items.length >= LIMITS.itemsMax) {
      return;
    }
    items.push(item());
    this.focusLast(`[data-meal="${mealIndex}"] mat-select[formcontrolname="foodCode"]`);
  }

  protected removeItem(mealIndex: number, itemIndex: number): void {
    const items = this.itemsOf(mealIndex);
    if (items.length <= LIMITS.itemsMin) {
      return;
    }
    items.removeAt(itemIndex);
  }

  protected submit(): void {
    if (this.submitting()) {
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.focusFirstInvalid();
      return;
    }
    const value = this.form.getRawValue();
    this.submitted.emit({
      title: value.title.trim(),
      description: value.description.trim(),
      goal: value.goal as RoutineGoal,
      sport: value.sport,
      dietaryPattern: value.dietaryPattern as RoutineDietPattern,
      // En el orden del catálogo de HU009, sin repetir.
      containsAllergens: ROUTINE_ALLERGENS.filter((allergen) => value.containsAllergens[allergen]),
      durationDays: value.durationDays as number,
      dailyMeals: value.dailyMeals.map((entry) => ({
        meal: entry.meal as RoutineMealType,
        items: entry.items.map((food) => ({
          foodCode: food.foodCode as string,
          portions: food.portions as number,
        })),
      })),
    });
  }

  private applyServerErrors(violations: readonly RoutineViolation[] | null): void {
    if (violations === null) {
      return;
    }
    const mealRules = new Map<number, string>();
    for (const violation of violations) {
      const issue = routineIssueKey(violation.issue);
      const target = routineTarget(violation.field);
      if (target.kind === 'field' && target.control === 'containsAllergens') {
        this.allergensRule.set(issue);
        continue;
      }
      if (target.kind === 'meal' && target.control !== 'meal') {
        mealRules.set(target.meal, issue);
        continue;
      }
      const control = this.controlFor(violation.field);
      if (control !== null) {
        control.setErrors({ ...control.errors, routineRule: issue });
        control.markAsTouched();
        this.serverMarked.push(control);
      }
    }
    this.mealRules.set(mealRules);
    this.focusSoon('[data-testid="routine-errors"]');
  }

  private controlFor(field: string): AbstractControl | null {
    const target = routineTarget(field);
    switch (target.kind) {
      case 'field':
        return this.form.controls[target.control];
      case 'meal':
        return (this.meals.at(target.meal) as MealGroup | undefined)?.controls.meal ?? null;
      case 'item': {
        const group = this.meals.at(target.meal)?.controls.items.at(target.item) as
          ItemGroup | undefined;
        return group?.controls[target.control ?? 'foodCode'] ?? null;
      }
      case 'meals':
      case 'none':
        return null;
    }
  }

  /** Al editar se retiran las marcas del backend; el resumen sigue hasta el siguiente envío. */
  private clearServerMarks(): void {
    const marked = this.serverMarked;
    this.serverMarked = [];
    for (const control of marked) {
      control.updateValueAndValidity({ emitEvent: false });
    }
    if (this.allergensRule() !== null) {
      this.allergensRule.set(null);
    }
    if (this.mealRules().size > 0) {
      this.mealRules.set(new Map());
    }
  }

  private focusLast(selector: string): void {
    afterNextRender(
      () => {
        const elements = this.host.nativeElement.querySelectorAll<HTMLElement>(selector);
        elements.item(elements.length - 1)?.focus();
      },
      { injector: this.injector },
    );
  }

  /** Enfoca un elemento que ya existe, después de que el control actualice sus clases. */
  private focusSoon(selector: string): void {
    queueMicrotask(() => this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus());
  }

  private focusFirstInvalid(): void {
    this.focusSoon('input.ng-invalid, textarea.ng-invalid, mat-select.ng-invalid');
  }
}
