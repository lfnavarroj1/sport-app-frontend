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
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { TranslatePipe } from '@ngx-translate/core';

import {
  GENDERS,
  INCOME_RANGES,
  MARITAL_STATUSES,
  PROFILE_COUNTRY_CODE_PATTERN,
  PROFILE_LIMITS,
} from '../../../../core/api/bff-web/profile.api';
import { ProfileFieldError } from '../profile-field-error/profile-field-error';
import { countryName } from '../profile-format';
import { trimmedLength } from '../profile-validators';
import { DemographicControl, controlsFor, fieldKey, issueKey } from '../profile-violations';
import {
  DemographicDraft,
  DemographicProfile,
  Gender,
  IncomeRange,
  MaritalStatus,
  ProfileViolation,
  ageOn,
  localDate,
} from '../profile.model';

const LIMITS = PROFILE_LIMITS;

/**
 * Formulario de la sección demográfica (HU005, ADR-034). Solo aplica las
 * restricciones por campo del contrato (obligatorios, catálogos cerrados,
 * longitudes tras recortar y patrón del país). La edad se muestra como dato
 * informativo y no bloquea el envío: la regla de 13 a 120 años la decide el
 * backend y llega como `serverErrors` (CA2).
 */
@Component({
  selector: 'app-demographic-form',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    ProfileFieldError,
    ReactiveFormsModule,
    TranslatePipe,
  ],
  templateUrl: './demographic-form.html',
  styleUrl: './demographic-form.scss',
})
export class DemographicForm implements OnInit {
  /** Sección vigente al reemplazar; `null` al registrar por primera vez. */
  readonly initial = input<DemographicProfile | null>(null);
  readonly submitting = input(false);
  readonly serverErrors = input<readonly ProfileViolation[] | null>(null);

  readonly submitted = output<DemographicDraft>();
  /** El deportista modificó los datos. */
  readonly edited = output();
  readonly cancelled = output();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly locale = inject(LOCALE_ID);

  protected readonly limits = LIMITS;
  protected readonly genders = GENDERS;
  protected readonly maritalStatuses = MARITAL_STATUSES;
  protected readonly incomeRanges = INCOME_RANGES;

  protected readonly form = new FormGroup({
    birthDate: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    gender: new FormControl<Gender | null>(null, { validators: [Validators.required] }),
    countryCode: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(PROFILE_COUNTRY_CODE_PATTERN)],
    }),
    city: new FormControl('', {
      nonNullable: true,
      validators: [trimmedLength(LIMITS.cityMin, LIMITS.cityMax)],
    }),
    maritalStatus: new FormControl<MaritalStatus | null>(null),
    occupation: new FormControl('', {
      nonNullable: true,
      validators: [trimmedLength(LIMITS.occupationMin, LIMITS.occupationMax, true)],
    }),
    incomeRange: new FormControl<IncomeRange | null>(null),
  });

  private readonly birthDateValue = toSignal(this.form.controls.birthDate.valueChanges, {
    initialValue: '',
  });
  private readonly countryValue = toSignal(this.form.controls.countryCode.valueChanges, {
    initialValue: '',
  });

  protected readonly countryLabel = computed(() => countryName(this.countryValue(), this.locale));

  /** Edad informativa en la fecha local del navegador; `null` sin fecha válida. */
  protected readonly age = computed(() => ageOn(this.birthDateValue(), localDate(new Date())));
  protected readonly ageOutOfRange = computed(() => {
    const age = this.age();
    return age !== null && (age < LIMITS.ageMin || age > LIMITS.ageMax);
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
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this.clearServerMarks();
      this.edited.emit();
    });
  }

  ngOnInit(): void {
    const initial = this.initial();
    if (initial !== null) {
      // Al reemplazar se parte de los valores confirmados, sin contarlo como edición.
      this.form.setValue(
        {
          birthDate: initial.birthDate,
          gender: initial.gender,
          countryCode: initial.countryCode,
          city: initial.city,
          maritalStatus: initial.maritalStatus,
          occupation: initial.occupation ?? '',
          incomeRange: initial.incomeRange,
        },
        { emitEvent: false },
      );
      // Solo estos dos controles notifican su valor, para la edad y el nombre del
      // país; `onlySelf` evita que el formulario lo emita como edición.
      this.form.controls.birthDate.setValue(initial.birthDate, { onlySelf: true });
      this.form.controls.countryCode.setValue(initial.countryCode, { onlySelf: true });
    }
  }

  /** El país se escribe en mayúsculas, como lo exige el contrato. */
  protected uppercaseCountry(): void {
    const control = this.form.controls.countryCode;
    const upper = control.value.toUpperCase();
    if (upper !== control.value) {
      control.setValue(upper);
    }
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
    const occupation = value.occupation.trim();
    this.submitted.emit({
      birthDate: value.birthDate,
      gender: value.gender as Gender,
      countryCode: value.countryCode.trim(),
      city: value.city.trim(),
      maritalStatus: value.maritalStatus,
      occupation: occupation === '' ? null : occupation,
      incomeRange: value.incomeRange,
    });
  }

  private applyServerErrors(violations: readonly ProfileViolation[] | null): void {
    if (violations === null) {
      return;
    }
    for (const violation of violations) {
      for (const name of controlsFor(violation.field)) {
        if (name in this.form.controls) {
          this.markServerError(name as DemographicControl, issueKey(violation));
        }
      }
    }
    queueMicrotask(() => {
      const summary = this.host.nativeElement.querySelector<HTMLElement>(
        '[data-testid="demographic-errors"]',
      );
      if (summary) {
        summary.focus();
      } else {
        this.focusFirstInvalid();
      }
    });
  }

  private markServerError(name: DemographicControl, ruleKey: string): void {
    const control = this.form.controls[name];
    control.setErrors({ ...control.errors, profileRule: ruleKey });
    control.markAsTouched();
    this.serverMarked.push(control);
  }

  /**
   * Al editar cualquier dato se retiran las marcas del backend (cambiar un campo
   * puede resolver otra regla). El resumen del último envío sigue visible hasta
   * el siguiente.
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
        .querySelector<HTMLElement>('input.ng-invalid, mat-select.ng-invalid')
        ?.focus(),
    );
  }
}
