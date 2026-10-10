import { Component, ElementRef, effect, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  FormRecord,
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

import { FieldError } from '../../../../shared/forms/field-error/field-error';
import {
  RegistrationDraft,
  RegistrationField,
  RegistrationOptions,
  RegistrationServerErrors,
} from '../registration.model';

const notBlank = (control: AbstractControl<string>): ValidationErrors | null =>
  control.value && control.value.trim() === '' ? { required: true } : null;

/**
 * Formulario de HU001. Solo aplica validaciones de experiencia (obligatorios y
 * formato); las reglas autoritativas (unicidad, catálogo, contraseña) son del
 * backend y llegan como `serverErrors`.
 */
@Component({
  selector: 'app-registration-form',
  imports: [
    FieldError,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    ReactiveFormsModule,
    TranslatePipe,
  ],
  templateUrl: './registration-form.html',
  styleUrl: './registration-form.scss',
})
export class RegistrationForm {
  readonly options = input.required<RegistrationOptions>();
  readonly submitting = input(false);
  readonly serverErrors = input<RegistrationServerErrors | null>(null);

  readonly submitted = output<RegistrationDraft>();
  /** El usuario modificó los datos después de cargarse el formulario. */
  readonly edited = output();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly passwordVisible = signal(false);

  protected readonly form = new FormGroup({
    fullName: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, notBlank],
    }),
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email],
    }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    actorType: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    policies: new FormRecord<FormControl<boolean>>({}),
  });

  constructor() {
    effect(() => {
      const policies = new FormRecord<FormControl<boolean>>({});
      for (const policy of this.options().policies) {
        policies.addControl(
          policy.id,
          new FormControl(false, {
            nonNullable: true,
            validators: policy.required ? [Validators.requiredTrue] : [],
          }),
        );
      }
      this.form.setControl('policies', policies);
    });

    effect(() => this.applyServerErrors(this.serverErrors()));

    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.edited.emit());
  }

  protected policyMissing(policyId: string): boolean {
    const control = this.form.controls.policies.get(policyId);
    return !!control && control.touched && control.invalid;
  }

  protected togglePasswordVisibility(): void {
    this.passwordVisible.update((visible) => !visible);
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
      fullName: value.fullName.trim(),
      email: value.email.trim(),
      password: value.password,
      actorType: value.actorType,
      acceptedPolicies: this.options()
        .policies.filter((policy) => value.policies[policy.id])
        .map(({ id, version }) => ({ id, version })),
    });
  }

  private applyServerErrors(errors: RegistrationServerErrors | null): void {
    if (!errors) {
      return;
    }
    if (errors.emailTaken) {
      this.markServerError('email', 'emailTaken');
    }
    for (const field of errors.invalidFields) {
      this.markServerError(field, 'server');
    }
    this.focusFirstInvalid();
  }

  private markServerError(field: RegistrationField, error: string): void {
    const control = this.form.controls[field];
    control.setErrors({ ...control.errors, [error]: true });
    control.markAsTouched();
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
