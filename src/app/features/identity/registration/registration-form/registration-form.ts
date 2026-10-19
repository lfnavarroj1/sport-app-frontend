import { DOCUMENT } from '@angular/common';
import {
  Component,
  ElementRef,
  InjectionToken,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
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

import { FieldError } from '../../../../shared/forms/field-error/field-error';
import { PrivacyNotice } from '../../privacy-notice/privacy-notice/privacy-notice';
import { PRIVACY_NOTICE_PATH } from '../../privacy-notice/privacy-notice.model';
import {
  RegistrationDraft,
  RegistrationField,
  RegistrationOptions,
  RegistrationServerErrors,
} from '../registration.model';

const notBlank = (control: AbstractControl<string>): ValidationErrors | null =>
  control.value && control.value.trim() === '' ? { required: true } : null;

/** Límites de `RegisterUserRequest` en el contrato bff-web 0.2.0. */
const LIMITS = {
  fullNameMax: 120,
  emailMax: 254,
  passwordMin: 12,
  passwordMax: 128,
} as const;

/**
 * Recarga la página para volver a leer la configuración y el aviso vigentes tras
 * `policies_version_mismatch`. Configurable para las pruebas.
 */
export const RELOAD_PAGE = new InjectionToken<() => void>('RELOAD_PAGE', {
  factory: () => {
    const document = inject(DOCUMENT);
    return () => document.location.reload();
  },
});

/**
 * Formulario de HU001. Solo aplica validaciones de experiencia (obligatorios,
 * formato y límites del contrato); las reglas autoritativas (unicidad, catálogo,
 * versión de políticas) son del backend y llegan como `serverErrors`.
 *
 * El aviso de tratamiento de datos puede leerse dentro del formulario o en su
 * página, que la etiqueta del consentimiento abre en una pestaña nueva. El
 * consentimiento es explícito: la casilla empieza desmarcada y, si el backend
 * rechaza la versión aceptada, se desmarca para que se acepte de nuevo tras leer
 * la versión vigente.
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
    PrivacyNotice,
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
  private readonly reloadPage = inject(RELOAD_PAGE);

  protected readonly passwordVisible = signal(false);
  /** El aviso se muestra dentro del formulario. */
  protected readonly noticeVisible = signal(false);
  protected readonly noticePath = PRIVACY_NOTICE_PATH;
  protected readonly limits = LIMITS;

  protected readonly form = new FormGroup({
    fullName: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, notBlank, Validators.maxLength(LIMITS.fullNameMax)],
    }),
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email, Validators.maxLength(LIMITS.emailMax)],
    }),
    password: new FormControl('', {
      nonNullable: true,
      validators: [
        Validators.required,
        Validators.minLength(LIMITS.passwordMin),
        Validators.maxLength(LIMITS.passwordMax),
      ],
    }),
    actorType: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    policies: new FormControl(false, { nonNullable: true, validators: [Validators.requiredTrue] }),
  });

  constructor() {
    effect(() => this.applyServerErrors(this.serverErrors()));

    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.edited.emit());
  }

  protected policiesError(): 'required' | 'outdated' | null {
    const control = this.form.controls.policies;
    if (!control.touched || control.valid) {
      return null;
    }
    return control.hasError('outdated') ? 'outdated' : 'required';
  }

  protected toggleNotice(): void {
    this.noticeVisible.update((visible) => !visible);
  }

  /** Vuelve a cargar la página para leer y aceptar la versión vigente. */
  protected reloadPolicies(): void {
    this.reloadPage();
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
      acceptedPoliciesVersion: this.options().policiesVersion,
    });
  }

  private applyServerErrors(errors: RegistrationServerErrors | null): void {
    if (!errors) {
      return;
    }
    if (errors.emailTaken) {
      this.markServerError('email', 'emailTaken');
    }
    if (errors.policiesOutdated) {
      // La aceptación era de una versión que ya no rige: se pide de nuevo.
      this.form.controls.policies.setValue(false, { emitEvent: false });
      this.markServerError('policies', 'outdated');
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
