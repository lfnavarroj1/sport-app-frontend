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
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { TranslatePipe } from '@ngx-translate/core';

import {
  TEMPLATE_DAYS,
  TEMPLATE_GOALS,
  TEMPLATE_LEVELS,
  TEMPLATE_LIMITS,
  TEMPLATE_SPORTS,
} from '../../../../core/api/bff-web/training-templates.api';
import {
  TemplateDay,
  TemplateDraft,
  TemplateGoal,
  TemplateLevel,
  TemplateSport,
  TemplateViolation,
  templateFieldText,
  templateIssueKey,
  templateTarget,
} from '../templates.model';
import { TemplateFieldError } from './template-field-error';

const LIMITS = TEMPLATE_LIMITS;

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

function wholeNumber(min: number, max: number) {
  return new FormControl<number | null>(null, {
    validators: [Validators.required, integer, Validators.min(min), Validators.max(max)],
  });
}

function session() {
  return new FormGroup({
    dayOfWeek: new FormControl<TemplateDay | null>(null, { validators: [Validators.required] }),
    description: new FormControl('', {
      nonNullable: true,
      validators: [trimmedLength(LIMITS.sessionDescriptionMin, LIMITS.sessionDescriptionMax)],
    }),
    durationMinutes: wholeNumber(LIMITS.sessionMinutesMin, LIMITS.sessionMinutesMax),
  });
}
type SessionGroup = ReturnType<typeof session>;

/**
 * Formulario para publicar una plantilla de plan (HU028, ADR-041): título,
 * objetivos, deporte del catálogo de HU010, objetivo de ADR-034, nivel, duración
 * en semanas y de 1 a 14 sesiones de una semana tipo (día, descripción y
 * minutos), en el orden del profesional. No tiene deportista ni fechas: no es un
 * plan asignado (HU010). Solo se validan las restricciones del contrato; las
 * reglas del servicio llegan en `details` y se marcan en su campo o en su sesión
 * (CA4).
 */
@Component({
  selector: 'app-template-form',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    ReactiveFormsModule,
    TemplateFieldError,
    TranslatePipe,
  ],
  templateUrl: './template-form.html',
  styleUrl: './template-form.scss',
})
export class TemplateForm {
  readonly submitting = input(false);
  readonly serverErrors = input<readonly TemplateViolation[] | null>(null);

  readonly submitted = output<TemplateDraft>();
  /** El profesional modificó los datos. */
  readonly edited = output();
  readonly cancelled = output();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly limits = LIMITS;
  protected readonly sports = TEMPLATE_SPORTS;
  protected readonly goals = TEMPLATE_GOALS;
  protected readonly levels = TEMPLATE_LEVELS;
  protected readonly days = TEMPLATE_DAYS;

  protected readonly form = new FormGroup({
    title: new FormControl('', {
      nonNullable: true,
      validators: [trimmedLength(LIMITS.titleMin, LIMITS.titleMax)],
    }),
    objectives: new FormControl('', {
      nonNullable: true,
      validators: [trimmedLength(LIMITS.objectivesMin, LIMITS.objectivesMax)],
    }),
    sport: new FormControl<TemplateSport | null>(null, { validators: [Validators.required] }),
    goal: new FormControl<TemplateGoal | null>(null, { validators: [Validators.required] }),
    level: new FormControl<TemplateLevel | null>(null, { validators: [Validators.required] }),
    durationWeeks: wholeNumber(LIMITS.weeksMin, LIMITS.weeksMax),
    weeklySessions: new FormArray<SessionGroup>([session()]),
  });

  protected readonly sessions = this.form.controls.weeklySessions;
  protected readonly sessionCount = signal(1);
  protected readonly canAddSession = computed(() => this.sessionCount() < LIMITS.sessionsMax);
  protected readonly canRemoveSession = computed(() => this.sessionCount() > LIMITS.sessionsMin);

  /** Resumen de las reglas que informó el backend en el último envío. */
  protected readonly summary = computed(() =>
    (this.serverErrors() ?? []).map((violation) => ({
      field: templateFieldText(violation.field),
      issue: templateIssueKey(violation.issue),
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

  protected addSession(): void {
    if (!this.canAddSession()) {
      return;
    }
    this.sessions.push(session());
    this.sessionCount.set(this.sessions.length);
    this.focusLast('[data-session] mat-select[formcontrolname="dayOfWeek"]');
  }

  protected removeSession(index: number): void {
    if (!this.canRemoveSession()) {
      return;
    }
    this.sessions.removeAt(index);
    this.sessionCount.set(this.sessions.length);
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
      objectives: value.objectives.trim(),
      sport: value.sport as TemplateSport,
      goal: value.goal as TemplateGoal,
      level: value.level as TemplateLevel,
      durationWeeks: value.durationWeeks as number,
      weeklySessions: value.weeklySessions.map((item) => ({
        dayOfWeek: item.dayOfWeek as TemplateDay,
        description: item.description.trim(),
        durationMinutes: item.durationMinutes as number,
      })),
    });
  }

  private applyServerErrors(violations: readonly TemplateViolation[] | null): void {
    if (violations === null) {
      return;
    }
    for (const violation of violations) {
      const control = this.controlFor(violation.field);
      if (control !== null) {
        control.setErrors({ ...control.errors, templateRule: templateIssueKey(violation.issue) });
        control.markAsTouched();
        this.serverMarked.push(control);
      }
    }
    this.focusSoon('[data-testid="template-errors"]');
  }

  private controlFor(field: string): AbstractControl | null {
    const target = templateTarget(field);
    switch (target.kind) {
      case 'field':
        return this.form.controls[target.control];
      case 'session': {
        const group = this.sessions.at(target.index) as SessionGroup | undefined;
        return group?.controls[target.control ?? 'description'] ?? null;
      }
      case 'sessions':
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
