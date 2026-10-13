import {
  Component,
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

import { TRAINING_PLAN_LIMITS } from '../../../../core/api/bff-web/training.api';
import { SPORT_OPTIONS, Sport } from '../../training-plan.model';
import { PlanDraft, PlanRuleViolation } from '../plan-authoring.model';
import { PlanFieldError } from '../plan-field-error/plan-field-error';
import { ViolationMessage, violationMessage, violationTarget } from '../plan-violations';

/** Rechazos del backend tras confirmar el plan. */
export interface PlanServerErrors {
  readonly violations: readonly PlanRuleViolation[];
  /** Correo inexistente o deportista sin autorización (`athlete_authorization_required`). */
  readonly athleteNotAuthorized: boolean;
}

const notBlank = (control: AbstractControl<string>): ValidationErrors | null =>
  control.value && control.value.trim() === '' ? { required: true } : null;

const integer = (control: AbstractControl<number | null>): ValidationErrors | null =>
  control.value !== null && !Number.isInteger(control.value) ? { integer: true } : null;

const LIMITS = TRAINING_PLAN_LIMITS;

function objectiveControl(): FormControl<string> {
  return new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, notBlank, Validators.maxLength(LIMITS.objectiveMax)],
  });
}

function sessionGroup() {
  return new FormGroup({
    scheduledDate: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    sport: new FormControl<Sport | null>(null, { validators: [Validators.required] }),
    durationMinutes: new FormControl<number | null>(null, {
      validators: [
        Validators.required,
        integer,
        Validators.min(LIMITS.durationMin),
        Validators.max(LIMITS.durationMax),
      ],
    }),
    intensityRpe: new FormControl<number | null>(null, {
      validators: [
        Validators.required,
        integer,
        Validators.min(LIMITS.intensityMin),
        Validators.max(LIMITS.intensityMax),
      ],
    }),
  });
}

/**
 * Editor de HU010: deportista (correo exacto), título, objetivos, periodo y
 * sesiones con deporte, duración e intensidad. Solo aplica validaciones de
 * experiencia derivadas del contrato (obligatorios, formato, cantidades y
 * rangos); la coherencia del plan (fechas, periodo, sesiones por día) la decide
 * el backend y llega como `serverErrors` (CA3).
 */
@Component({
  selector: 'app-plan-form',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    PlanFieldError,
    ReactiveFormsModule,
    TranslatePipe,
  ],
  templateUrl: './plan-form.html',
  styleUrl: './plan-form.scss',
})
export class PlanForm {
  readonly serverErrors = input<PlanServerErrors | null>(null);

  /** Los datos son válidos y el profesional pide revisarlos antes de asignar. */
  readonly reviewed = output<PlanDraft>();
  /** El profesional modificó los datos. */
  readonly edited = output();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly formDirective = viewChild.required(FormGroupDirective);

  protected readonly limits = LIMITS;
  protected readonly sports = SPORT_OPTIONS;

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
    sessions: new FormArray([sessionGroup()]),
  });

  /** Cantidades actuales, para habilitar agregar o quitar sin superar los límites. */
  protected readonly objectiveCount = signal(1);
  protected readonly sessionCount = signal(1);

  protected readonly summary = computed<readonly ViolationMessage[]>(() =>
    (this.serverErrors()?.violations ?? []).map(violationMessage),
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

  /** Vuelve al formulario inicial para crear otro plan. */
  reset(): void {
    this.form.controls.objectives.clear({ emitEvent: false });
    this.form.controls.objectives.push(objectiveControl(), { emitEvent: false });
    this.form.controls.sessions.clear({ emitEvent: false });
    this.form.controls.sessions.push(sessionGroup(), { emitEvent: false });
    // También reinicia el estado «enviado»: los campos vacíos no se marcan como error.
    this.formDirective().resetForm();
    this.syncCounts();
  }

  protected get objectives(): FormArray<FormControl<string>> {
    return this.form.controls.objectives;
  }

  protected get sessions(): FormArray<ReturnType<typeof sessionGroup>> {
    return this.form.controls.sessions;
  }

  protected addObjective(): void {
    if (this.objectives.length < LIMITS.objectivesMax) {
      this.objectives.push(objectiveControl());
      this.syncCounts();
      this.focusLast('objective');
    }
  }

  protected removeObjective(index: number): void {
    if (this.objectives.length > LIMITS.objectivesMin) {
      this.objectives.removeAt(index);
      this.syncCounts();
    }
  }

  protected addSession(): void {
    if (this.sessions.length < LIMITS.sessionsMax) {
      this.sessions.push(sessionGroup());
      this.syncCounts();
      this.focusLast('session');
    }
  }

  protected removeSession(index: number): void {
    if (this.sessions.length > LIMITS.sessionsMin) {
      this.sessions.removeAt(index);
      this.syncCounts();
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
      sessions: value.sessions.map((session) => ({
        scheduledDate: session.scheduledDate,
        sport: session.sport as Sport,
        durationMinutes: session.durationMinutes as number,
        intensityRpe: session.intensityRpe as number,
      })),
    });
  }

  private applyServerErrors(errors: PlanServerErrors | null): void {
    if (errors === null) {
      return;
    }
    if (errors.athleteNotAuthorized) {
      this.markServerError(this.form.controls.athleteEmail, { athleteNotAuthorized: true });
    }
    for (const violation of errors.violations) {
      const control = this.controlFor(violation.path);
      if (control) {
        this.markServerError(control, { planRule: violation.issue });
      }
    }
    // El resumen de reglas incumplidas recibe el foco; sin él, el primer campo inválido.
    queueMicrotask(() => {
      const summary = this.host.nativeElement.querySelector<HTMLElement>(
        '[data-testid="plan-errors"]',
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
      case 'session':
        return this.sessions.at(target.index)?.controls[target.field] ?? null;
      default:
        return this.form.controls[target.control];
    }
  }

  private markServerError(control: AbstractControl, error: ValidationErrors): void {
    control.setErrors({ ...control.errors, ...error });
    control.markAsTouched();
    this.serverMarked.push(control);
  }

  /**
   * Las reglas de coherencia relacionan campos (cambiar la fecha de inicio puede
   * resolver una regla informada en la de fin): al editar cualquier dato se
   * retiran las marcas del backend y solo quedan las validaciones de experiencia.
   * El resumen del último envío sigue visible hasta el siguiente.
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
    this.sessionCount.set(this.sessions.length);
  }

  private focusLast(kind: 'objective' | 'session'): void {
    queueMicrotask(() => {
      const inputs = this.host.nativeElement.querySelectorAll<HTMLElement>(
        `[data-focus="${kind}"]`,
      );
      inputs.item(inputs.length - 1)?.focus();
    });
  }

  private focusFirstInvalid(): void {
    queueMicrotask(() =>
      this.host.nativeElement
        .querySelector<HTMLElement>('input.ng-invalid, mat-select.ng-invalid')
        ?.focus(),
    );
  }
}
