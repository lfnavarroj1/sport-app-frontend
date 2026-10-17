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
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { TranslatePipe } from '@ngx-translate/core';

import { PROFILE_LIMITS } from '../../../../core/api/bff-web/profile.api';
import { ProfileFieldError } from '../profile-field-error/profile-field-error';
import { browserTimeZone, formatDecimal } from '../profile-format';
import { decimalInRange, integer, localDateTime, pairedWith } from '../profile-validators';
import { PhysiologicalControl, controlsFor, fieldKey, issueKey } from '../profile-violations';
import {
  PhysiologicalDraft,
  PhysiologicalProfile,
  ProfileViolation,
  localDateTimeToUtc,
  normalizeDecimal,
  toLocalDateTimeInput,
} from '../profile.model';

const LIMITS = PROFILE_LIMITS;

function bounded(min: number, max: number, extra: ValidatorFn[] = []): FormControl<number | null> {
  return new FormControl<number | null>(null, {
    validators: [integer, Validators.min(min), Validators.max(max), ...extra],
  });
}

/**
 * Formulario de la sección fisiológica (HU005, ADR-034). Los decimales se
 * capturan como texto (coma o punto) y viajan como cadena; el IMC no se captura
 * ni se calcula aquí: lo devuelve el backend. Solo se validan las restricciones
 * por campo del contrato y el par de la presión arterial (objeto con ambos
 * valores). Sistólica mayor que diastólica y la ventana de `measured_at` las
 * decide el backend (CA2). Cada envío vuelve a aceptar el consentimiento de
 * datos de salud, por eso la casilla empieza desmarcada (CA3).
 */
@Component({
  selector: 'app-physiological-form',
  imports: [
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    ProfileFieldError,
    ReactiveFormsModule,
    TranslatePipe,
  ],
  templateUrl: './physiological-form.html',
  styleUrl: './physiological-form.scss',
})
export class PhysiologicalForm implements OnInit {
  /** Sección vigente al reemplazar; `null` al registrar por primera vez. */
  readonly initial = input<PhysiologicalProfile | null>(null);
  /** Versión vigente del consentimiento (`healthDataConsentVersion`). */
  readonly consentVersion = input.required<string>();
  readonly submitting = input(false);
  readonly serverErrors = input<readonly ProfileViolation[] | null>(null);

  readonly submitted = output<PhysiologicalDraft>();
  /** El deportista modificó los datos. */
  readonly edited = output();
  readonly cancelled = output();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly locale = inject(LOCALE_ID);

  protected readonly limits = LIMITS;
  protected readonly zone = browserTimeZone();
  protected readonly weightRange = {
    min: this.decimal(LIMITS.weightMin),
    max: this.decimal(LIMITS.weightMax),
  };
  protected readonly temperatureRange = {
    min: this.decimal(LIMITS.bodyTemperatureMin),
    max: this.decimal(LIMITS.bodyTemperatureMax),
  };

  protected readonly form = new FormGroup({
    measuredAt: new FormControl(toLocalDateTimeInput(new Date()), {
      nonNullable: true,
      validators: [Validators.required, localDateTime],
    }),
    weightKg: new FormControl('', {
      nonNullable: true,
      validators: [
        decimalInRange(LIMITS.weightMin, LIMITS.weightMax, {
          optional: false,
          display: (value) => this.decimal(value),
        }),
      ],
    }),
    heightCm: bounded(LIMITS.heightMin, LIMITS.heightMax, [Validators.required]),
    restingHeartRateBpm: bounded(LIMITS.restingHeartRateMin, LIMITS.restingHeartRateMax),
    systolic: bounded(LIMITS.systolicMin, LIMITS.systolicMax, [pairedWith('diastolic')]),
    diastolic: bounded(LIMITS.diastolicMin, LIMITS.diastolicMax, [pairedWith('systolic')]),
    bodyTemperatureC: new FormControl('', {
      nonNullable: true,
      validators: [
        decimalInRange(LIMITS.bodyTemperatureMin, LIMITS.bodyTemperatureMax, {
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
      field: fieldKey(violation),
      issue: issueKey(violation),
    })),
  );

  /** Controles marcados con un rechazo del backend en el último envío. */
  private serverMarked: AbstractControl[] = [];

  constructor() {
    effect(() => this.applyServerErrors(this.serverErrors()));
    const { systolic, diastolic } = this.form.controls;
    // La exigencia del par depende del otro valor: se recalcula al cambiar cualquiera.
    systolic.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => diastolic.updateValueAndValidity({ emitEvent: false }));
    diastolic.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => systolic.updateValueAndValidity({ emitEvent: false }));
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this.clearServerMarks();
      this.edited.emit();
    });
  }

  ngOnInit(): void {
    const initial = this.initial();
    if (initial !== null) {
      // Al reemplazar se parte de los valores confirmados, sin contarlo como edición.
      // Reemplazar registra una medición nueva: `measuredAt` sigue siendo «ahora».
      // El consentimiento no se precarga: se acepta de nuevo en cada envío.
      this.form.setValue(
        {
          measuredAt: this.form.controls.measuredAt.value,
          weightKg: this.decimal(initial.weightKg),
          heightCm: initial.heightCm,
          restingHeartRateBpm: initial.restingHeartRateBpm,
          systolic: initial.bloodPressure?.systolic ?? null,
          diastolic: initial.bloodPressure?.diastolic ?? null,
          bodyTemperatureC:
            initial.bodyTemperatureC === null ? '' : this.decimal(initial.bodyTemperatureC),
          consent: false,
        },
        { emitEvent: false },
      );
    }
  }

  /** Rechazo del backend sobre el consentimiento (CA3), como clave i18n. */
  protected consentRule(): string | null {
    const rule: unknown = this.form.controls.consent.errors?.['profileRule'];
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
    const temperature = normalizeDecimal(value.bodyTemperatureC);
    this.submitted.emit({
      consentVersion: this.consentVersion(),
      measuredAt: localDateTimeToUtc(value.measuredAt) as string,
      weightKg: normalizeDecimal(value.weightKg),
      heightCm: value.heightCm as number,
      restingHeartRateBpm: value.restingHeartRateBpm,
      bloodPressure:
        value.systolic === null || value.diastolic === null
          ? null
          : { systolic: value.systolic, diastolic: value.diastolic },
      bodyTemperatureC: temperature === '' ? null : temperature,
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
      for (const name of controlsFor(violation.field)) {
        if (name in this.form.controls) {
          this.markServerError(name as PhysiologicalControl, issueKey(violation));
        }
      }
    }
    queueMicrotask(() => {
      const summary = this.host.nativeElement.querySelector<HTMLElement>(
        '[data-testid="physiological-errors"]',
      );
      if (summary) {
        summary.focus();
      } else {
        this.focusFirstInvalid();
      }
    });
  }

  private markServerError(name: PhysiologicalControl, ruleKey: string): void {
    const control = this.form.controls[name];
    control.setErrors({ ...control.errors, profileRule: ruleKey });
    control.markAsTouched();
    this.serverMarked.push(control);
  }

  /**
   * Al editar cualquier dato se retiran las marcas del backend (cambiar la
   * diastólica puede resolver la coherencia de la presión). El resumen del
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
        .querySelector<HTMLElement>('input.ng-invalid, mat-checkbox.ng-invalid input')
        ?.focus(),
    );
  }
}
