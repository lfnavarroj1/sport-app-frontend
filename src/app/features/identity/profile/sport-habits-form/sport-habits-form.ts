import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  OnInit,
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
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { TranslatePipe } from '@ngx-translate/core';

import {
  HABIT_INTENSITIES,
  HABIT_LEVELS,
  HABIT_SPORTS,
  PRIMARY_GOALS,
  SPORT_HABITS_LIMITS,
  TIME_SLOTS,
  WEEK_DAYS,
} from '../../../../core/api/bff-web/profile.api';
import { ProfileFieldError } from '../profile-field-error/profile-field-error';
import { integer } from '../profile-validators';
import {
  HabitIntensity,
  HabitLevel,
  HabitSport,
  PrimaryGoal,
  ProfileViolation,
  SportHabit,
  SportHabits,
  SportHabitsDraft,
} from '../profile.model';
import {
  SportHabitControl,
  sportHabitsFieldText,
  sportHabitsIssueKey,
  sportHabitsTarget,
} from '../sport-habits-violations';

const LIMITS = SPORT_HABITS_LIMITS;

function wholeNumber(min: number, max: number, required: boolean) {
  return [
    ...(required ? [Validators.required] : []),
    integer,
    Validators.min(min),
    Validators.max(max),
  ];
}

function sportRow(habit: SportHabit | null = null) {
  return new FormGroup({
    sport: new FormControl<HabitSport | null>(habit?.sport ?? null, {
      validators: [Validators.required],
    }),
    frequencyPerWeek: new FormControl<number | null>(habit?.frequencyPerWeek ?? null, {
      validators: wholeNumber(LIMITS.frequencyMin, LIMITS.frequencyMax, true),
    }),
    sessionDurationMinutes: new FormControl<number | null>(habit?.sessionDurationMinutes ?? null, {
      validators: wholeNumber(LIMITS.durationMin, LIMITS.durationMax, true),
    }),
    intensity: new FormControl<HabitIntensity | null>(habit?.intensity ?? null, {
      validators: [Validators.required],
    }),
    level: new FormControl<HabitLevel | null>(habit?.level ?? null, {
      validators: [Validators.required],
    }),
    yearsPracticing: new FormControl<number | null>(habit?.yearsPracticing ?? null, {
      validators: wholeNumber(LIMITS.yearsMin, LIMITS.yearsMax, false),
    }),
  });
}
type SportRow = ReturnType<typeof sportRow>;

/** Casillas de un catálogo cerrado (días o franjas), todas sin marcar. */
function checkboxes<T extends string>(catalog: readonly T[], checked: readonly T[] = []) {
  const controls = Object.fromEntries(
    catalog.map((value) => [
      value,
      new FormControl(checked.includes(value), { nonNullable: true }),
    ]),
  ) as Record<T, FormControl<boolean>>;
  return new FormGroup(controls, { validators: [atLeastOneChecked] });
}

/** Al menos una casilla marcada (`minItems: 1` de días y franjas). */
function atLeastOneChecked(group: AbstractControl): ValidationErrors | null {
  const values = Object.values((group as FormGroup).controls).map((control) => control.value);
  return values.includes(true) ? null : { required: true };
}

/** Un mismo deporte no puede estar en dos filas (`sports` sin repetir). */
function uniqueSports(array: AbstractControl): ValidationErrors | null {
  const sports = (array as FormArray<SportRow>).controls
    .map((row) => row.controls.sport.value)
    .filter((sport) => sport !== null);
  return new Set(sports).size === sports.length ? null : { duplicateSport: true };
}

/**
 * Formulario de la sección «Hábitos deportivos» (HU006, ADR-034): de uno a
 * cinco deportes del catálogo de HU010 con frecuencia, duración, intensidad,
 * nivel y años de práctica opcionales; los días y las franjas disponibles; y
 * el objetivo principal opcional. Solo aplica las restricciones por campo del
 * contrato (catálogos cerrados, enteros y rangos, listas de 1 a N sin repetir):
 * un deporte ya elegido no se ofrece en otra fila y no se puede agregar una
 * sexta. Las reglas que informa el backend llegan como `serverErrors`, marcadas
 * en la fila y el campo de su posición (`sports[1].sport`) (CA2).
 */
@Component({
  selector: 'app-sport-habits-form',
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
  templateUrl: './sport-habits-form.html',
  styleUrl: './sport-habits-form.scss',
})
export class SportHabitsForm implements OnInit {
  /** Hábitos vigentes al reemplazar; `null` al registrar por primera vez. */
  readonly initial = input<SportHabits | null>(null);
  readonly submitting = input(false);
  readonly serverErrors = input<readonly ProfileViolation[] | null>(null);

  readonly submitted = output<SportHabitsDraft>();
  /** El deportista modificó los datos. */
  readonly edited = output();
  readonly cancelled = output();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly limits = LIMITS;
  protected readonly sportOptions = HABIT_SPORTS;
  protected readonly intensities = HABIT_INTENSITIES;
  protected readonly levels = HABIT_LEVELS;
  protected readonly weekDays = WEEK_DAYS;
  protected readonly timeSlots = TIME_SLOTS;
  protected readonly goals = PRIMARY_GOALS;

  protected readonly form = new FormGroup({
    sports: new FormArray<SportRow>([sportRow()], { validators: [uniqueSports] }),
    days: checkboxes(WEEK_DAYS),
    timeSlots: checkboxes(TIME_SLOTS),
    primaryGoal: new FormControl<PrimaryGoal | null>(null),
  });

  /** Deporte elegido en cada fila, para no ofrecerlo en las demás. */
  private readonly chosen = signal<readonly (HabitSport | null)[]>([null]);
  protected readonly rowCount = computed(() => this.chosen().length);
  protected readonly atMax = computed(() => this.rowCount() >= LIMITS.sportsMax);

  /** Resumen de las reglas que informó el backend en el último envío. */
  protected readonly summary = computed(() =>
    (this.serverErrors() ?? []).map((violation) => ({
      field: sportHabitsFieldText(violation),
      issue: sportHabitsIssueKey(violation),
    })),
  );

  /** Controles marcados con un rechazo del backend en el último envío. */
  private serverMarked: AbstractControl[] = [];

  constructor() {
    effect(() => this.applyServerErrors(this.serverErrors()));
    this.form.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.syncChosen();
      this.clearServerMarks();
      this.edited.emit();
    });
  }

  ngOnInit(): void {
    const initial = this.initial();
    if (initial !== null) {
      // Al reemplazar se parte de los valores confirmados, sin contarlo como edición.
      this.sports.clear({ emitEvent: false });
      for (const habit of initial.sports) {
        this.sports.push(sportRow(habit), { emitEvent: false });
      }
      this.setChecked(this.form.controls.days, initial.days);
      this.setChecked(this.form.controls.timeSlots, initial.timeSlots);
      this.form.controls.primaryGoal.setValue(initial.primaryGoal, { emitEvent: false });
      this.sports.updateValueAndValidity({ emitEvent: false });
      this.syncChosen();
    }
  }

  protected get sports(): FormArray<SportRow> {
    return this.form.controls.sports;
  }

  /** El deporte ya está elegido en otra fila: no se ofrece en esta. */
  protected takenElsewhere(sport: HabitSport, row: number): boolean {
    return this.chosen().some((chosen, index) => index !== row && chosen === sport);
  }

  /** La fila repite el deporte de una fila anterior. */
  protected duplicated(row: number): boolean {
    const sport = this.chosen()[row];
    return sport !== null && this.chosen().slice(0, row).includes(sport);
  }

  protected addSport(): void {
    if (this.sports.length >= LIMITS.sportsMax || this.submitting()) {
      return;
    }
    this.sports.push(sportRow());
    this.focusLast('[data-focus="sport"]');
  }

  protected removeSport(index: number): void {
    if (this.sports.length <= LIMITS.sportsMin || this.submitting()) {
      return;
    }
    this.sports.removeAt(index);
    afterNextRender(
      () =>
        this.host.nativeElement
          .querySelector<HTMLElement>('[data-testid="sport-habits-add"]')
          ?.focus(),
      { injector: this.injector },
    );
  }

  /** Mensaje de un grupo de casillas: la regla del backend o la de experiencia. */
  protected groupRule(group: AbstractControl, requiredKey: string): string | null {
    const errors = group.errors;
    if (!errors || !group.touched) {
      return null;
    }
    return (errors['profileRule'] as string | undefined) ?? requiredKey;
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
      sports: value.sports.map((row) => ({
        sport: row.sport as HabitSport,
        frequencyPerWeek: row.frequencyPerWeek as number,
        sessionDurationMinutes: row.sessionDurationMinutes as number,
        intensity: row.intensity as HabitIntensity,
        level: row.level as HabitLevel,
        yearsPracticing: row.yearsPracticing,
      })),
      days: WEEK_DAYS.filter((day) => value.days[day]),
      timeSlots: TIME_SLOTS.filter((slot) => value.timeSlots[slot]),
      primaryGoal: value.primaryGoal,
    });
  }

  private setChecked<T extends string>(
    group: FormGroup<Record<T, FormControl<boolean>>>,
    checked: readonly T[],
  ): void {
    for (const [value, control] of Object.entries(group.controls) as [T, FormControl<boolean>][]) {
      control.setValue(checked.includes(value), { emitEvent: false });
    }
    group.updateValueAndValidity({ emitEvent: false });
  }

  private syncChosen(): void {
    this.chosen.set(this.sports.controls.map((row) => row.controls.sport.value));
  }

  private applyServerErrors(violations: readonly ProfileViolation[] | null): void {
    if (violations === null) {
      return;
    }
    for (const violation of violations) {
      const control = this.controlFor(violation);
      if (control !== null) {
        control.setErrors({ ...control.errors, profileRule: sportHabitsIssueKey(violation) });
        control.markAsTouched();
        this.serverMarked.push(control);
      }
    }
    queueMicrotask(() => {
      const summary = this.host.nativeElement.querySelector<HTMLElement>(
        '[data-testid="sport-habits-errors"]',
      );
      if (summary) {
        summary.focus();
      } else {
        this.focusFirstInvalid();
      }
    });
  }

  /** Control donde se marca la regla; `null` si solo va al resumen. */
  private controlFor(violation: ProfileViolation): AbstractControl | null {
    const target = sportHabitsTarget(violation.field);
    switch (target.kind) {
      case 'sports':
        return this.sports;
      case 'sport': {
        const row = this.sports.at(target.index) as SportRow | undefined;
        // Una regla de la fila completa se muestra en su deporte.
        const name: SportHabitControl = target.control ?? 'sport';
        return row?.controls[name] ?? null;
      }
      case 'days':
      case 'availability':
        // `availability` sin detalle marca los días; el resumen lo explica.
        return this.form.controls.days;
      case 'timeSlots':
        return this.form.controls.timeSlots;
      case 'primaryGoal':
        return this.form.controls.primaryGoal;
      case 'none':
        return null;
    }
  }

  /**
   * Al editar cualquier dato se retiran las marcas del backend (cambiar un
   * campo puede resolver otra regla). El resumen del último envío sigue visible
   * hasta el siguiente.
   */
  private clearServerMarks(): void {
    const marked = this.serverMarked;
    this.serverMarked = [];
    for (const control of marked) {
      control.updateValueAndValidity({ emitEvent: false });
    }
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
        .querySelector<HTMLElement>(
          'input.ng-invalid, mat-select.ng-invalid, [data-group].ng-invalid input',
        )
        ?.focus(),
    );
  }
}
