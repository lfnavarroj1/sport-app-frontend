import {
  Component,
  ElementRef,
  LOCALE_ID,
  OnInit,
  computed,
  effect,
  inject,
  input,
  output,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { TranslatePipe } from '@ngx-translate/core';

import {
  DIET_PATTERNS,
  DIET_RESTRICTIONS,
  FOOD_ALLERGIES,
  NUTRITION_HABITS_LIMITS,
} from '../../../../core/api/bff-web/profile.api';
import {
  nutritionHabitsControl,
  nutritionHabitsFieldKey,
  nutritionHabitsIssueKey,
} from '../nutrition-habits-violations';
import { ProfileFieldError } from '../profile-field-error/profile-field-error';
import { formatDecimal } from '../profile-format';
import { decimalInRange } from '../profile-validators';
import {
  DietPattern,
  NutritionHabits,
  NutritionHabitsDraft,
  ProfileViolation,
  normalizeDecimal,
} from '../profile.model';

const LIMITS = NUTRITION_HABITS_LIMITS;

/** Casillas de un catálogo cerrado (restricciones o alergias). Ninguna es obligatoria. */
function checkboxes<T extends string>(catalog: readonly T[], checked: readonly T[] = []) {
  const controls = Object.fromEntries(
    catalog.map((value) => [
      value,
      new FormControl(checked.includes(value), { nonNullable: true }),
    ]),
  ) as Record<T, FormControl<boolean>>;
  return new FormGroup(controls);
}

/**
 * Formulario de los hábitos alimenticios (HU009, ADR-035). Solo catálogos
 * cerrados: el patrón y las comidas por día se eligen de una lista, restricciones
 * y alergias son casillas (no pueden repetirse) y la hidratación es un decimal
 * capturado como texto (coma o punto) que viaja como cadena. Solo se validan las
 * restricciones del contrato; las demás reglas llegan del backend (CA2). Cada
 * envío vuelve a aceptar el consentimiento de datos de salud, así que la casilla
 * empieza desmarcada y «Guardar» queda deshabilitado sin ella.
 */
@Component({
  selector: 'app-nutrition-habits-form',
  imports: [
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    ProfileFieldError,
    ReactiveFormsModule,
    TranslatePipe,
  ],
  templateUrl: './nutrition-habits-form.html',
  styleUrl: './nutrition-habits-form.scss',
})
export class NutritionHabitsForm implements OnInit {
  /** Sección vigente al reemplazar; `null` al registrar por primera vez. */
  readonly initial = input<NutritionHabits | null>(null);
  /** Versión vigente del consentimiento (`healthDataConsentVersion`). */
  readonly consentVersion = input.required<string>();
  readonly submitting = input(false);
  readonly serverErrors = input<readonly ProfileViolation[] | null>(null);

  readonly submitted = output<NutritionHabitsDraft>();
  /** El deportista modificó los datos. */
  readonly edited = output();
  readonly cancelled = output();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly locale = inject(LOCALE_ID);

  protected readonly patterns = DIET_PATTERNS;
  protected readonly restrictionOptions = DIET_RESTRICTIONS;
  protected readonly allergyOptions = FOOD_ALLERGIES;
  protected readonly meals = Array.from(
    { length: LIMITS.mealsMax - LIMITS.mealsMin + 1 },
    (_, index) => LIMITS.mealsMin + index,
  );
  protected readonly hydrationRange = {
    min: this.decimal(LIMITS.hydrationMin),
    max: this.decimal(LIMITS.hydrationMax),
  };

  protected readonly form = new FormGroup({
    dietPattern: new FormControl<DietPattern | null>(null, { validators: [Validators.required] }),
    restrictions: checkboxes(DIET_RESTRICTIONS),
    allergies: checkboxes(FOOD_ALLERGIES),
    mealsPerDay: new FormControl<number | null>(null, { validators: [Validators.required] }),
    hydration: new FormControl('', {
      nonNullable: true,
      validators: [
        decimalInRange(LIMITS.hydrationMin, LIMITS.hydrationMax, {
          optional: true,
          display: (value) => this.decimal(value),
        }),
      ],
    }),
    consent: new FormControl(false, { nonNullable: true, validators: [Validators.requiredTrue] }),
  });

  protected readonly consentChecked = toSignal(this.form.controls.consent.valueChanges, {
    initialValue: false,
  });

  /** Resumen de las reglas que informó el backend en el último envío. */
  protected readonly summary = computed(() =>
    (this.serverErrors() ?? []).map((violation) => ({
      field: nutritionHabitsFieldKey(violation),
      issue: nutritionHabitsIssueKey(violation),
    })),
  );

  /** Controles marcados con un rechazo del backend en el último envío. */
  private serverMarked: AbstractControl[] = [];

  constructor() {
    effect(() => this.applyServerErrors(this.serverErrors()));
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this.clearServerMarks();
      this.edited.emit();
    });
  }

  ngOnInit(): void {
    const initial = this.initial();
    if (initial !== null) {
      // Al reemplazar se parte de los valores confirmados, sin contarlo como edición.
      // El consentimiento no se precarga: se acepta de nuevo en cada envío.
      this.form.setValue(
        {
          dietPattern: initial.dietPattern,
          restrictions: checkedMap(DIET_RESTRICTIONS, initial.restrictions),
          allergies: checkedMap(FOOD_ALLERGIES, initial.allergies),
          mealsPerDay: initial.mealsPerDay,
          hydration:
            initial.hydrationLitersPerDay === null
              ? ''
              : this.decimal(initial.hydrationLitersPerDay),
          consent: false,
        },
        { emitEvent: false },
      );
    }
  }

  /** Regla del backend sobre un grupo de casillas o el consentimiento, como clave i18n. */
  protected rule(control: AbstractControl): string | null {
    const rule: unknown = control.errors?.['profileRule'];
    return typeof rule === 'string' ? rule : null;
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
    const hydration = normalizeDecimal(value.hydration);
    this.submitted.emit({
      consentVersion: this.consentVersion(),
      dietPattern: value.dietPattern as DietPattern,
      restrictions: DIET_RESTRICTIONS.filter((item) => value.restrictions[item]),
      allergies: FOOD_ALLERGIES.filter((item) => value.allergies[item]),
      mealsPerDay: value.mealsPerDay as number,
      hydrationLitersPerDay: hydration === '' ? null : hydration,
    });
  }

  private decimal(value: string): string {
    return formatDecimal(value, this.locale);
  }

  private applyServerErrors(violations: readonly ProfileViolation[] | null): void {
    if (violations === null) {
      return;
    }
    for (const violation of violations) {
      const name = nutritionHabitsControl(violation.field);
      if (name !== null) {
        const control: AbstractControl = this.form.controls[name];
        control.setErrors({ ...control.errors, profileRule: nutritionHabitsIssueKey(violation) });
        control.markAsTouched();
        this.serverMarked.push(control);
      }
    }
    queueMicrotask(() => {
      const summary = this.host.nativeElement.querySelector<HTMLElement>(
        '[data-testid="nutrition-habits-errors"]',
      );
      if (summary) {
        summary.focus();
      } else {
        this.focusFirstInvalid();
      }
    });
  }

  /**
   * Al editar cualquier dato se retiran las marcas del backend. El resumen del
   * último envío sigue visible hasta el siguiente.
   */
  private clearServerMarks(): void {
    const marked = this.serverMarked;
    this.serverMarked = [];
    for (const control of marked) {
      control.updateValueAndValidity({ emitEvent: false });
    }
  }

  private focusFirstInvalid(): void {
    queueMicrotask(() =>
      this.host.nativeElement
        .querySelector<HTMLElement>(
          'input.ng-invalid, mat-select.ng-invalid, mat-checkbox.ng-invalid input',
        )
        ?.focus(),
    );
  }
}

function checkedMap<T extends string>(
  catalog: readonly T[],
  checked: readonly T[],
): Record<T, boolean> {
  return Object.fromEntries(catalog.map((value) => [value, checked.includes(value)])) as Record<
    T,
    boolean
  >;
}
