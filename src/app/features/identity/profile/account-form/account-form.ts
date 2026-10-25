import {
  Component,
  ElementRef,
  OnInit,
  computed,
  effect,
  inject,
  input,
  output,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { TranslatePipe } from '@ngx-translate/core';

import { ACCOUNT_LIMITS } from '../../../../core/api/bff-web/account.api';
import { ProfileFieldError } from '../profile-field-error/profile-field-error';
import { trimmedLength } from '../profile-validators';
import { Account, AccountDraft, AccountViolation, KNOWN_ACCOUNT_ISSUES } from './account.model';

type AccountControl = 'fullName' | 'email';

/** Ruta de `details[].field` → control del formulario. */
const CONTROL_BY_FIELD: Readonly<Record<string, AccountControl>> = {
  full_name: 'fullName',
  email: 'email',
};

/** Clave i18n del motivo, del catálogo común del perfil. */
function issueKey(violation: AccountViolation): string {
  return `profile.issues.${KNOWN_ACCOUNT_ISSUES.includes(violation.issue) ? violation.issue : 'unknown'}`;
}

/** Clave i18n del campo, para el resumen; los campos ajenos al formulario son «Solicitud». */
function fieldKey(violation: AccountViolation): string {
  const control = CONTROL_BY_FIELD[violation.field];
  return control ? `profile.personal.fields.${control}` : 'profile.issues.fieldRequest';
}

/**
 * Formulario de «Datos personales» (HU002, ADR-035). Solo aplica las
 * restricciones por campo del contrato (obligatorios, longitudes tras recortar y
 * formato del correo). La normalización y la unicidad del correo las decide el
 * backend: llegan como `serverErrors` o `emailTaken` (CA3).
 */
@Component({
  selector: 'app-account-form',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    ProfileFieldError,
    ReactiveFormsModule,
    TranslatePipe,
  ],
  templateUrl: './account-form.html',
  styleUrl: './account-form.scss',
})
export class AccountForm implements OnInit {
  /** Cuenta vigente: el formulario parte de sus valores. */
  readonly initial = input.required<Account>();
  readonly submitting = input(false);
  readonly serverErrors = input<readonly AccountViolation[] | null>(null);
  /** El backend respondió `409 email_already_registered` al último envío. */
  readonly emailTaken = input(false);

  readonly submitted = output<AccountDraft>();
  /** El usuario modificó los datos. */
  readonly edited = output();
  readonly cancelled = output();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly limits = ACCOUNT_LIMITS;

  protected readonly form = new FormGroup({
    fullName: new FormControl('', {
      nonNullable: true,
      validators: [trimmedLength(ACCOUNT_LIMITS.fullNameMin, ACCOUNT_LIMITS.fullNameMax)],
    }),
    email: new FormControl('', {
      nonNullable: true,
      validators: [
        Validators.required,
        Validators.email,
        Validators.maxLength(ACCOUNT_LIMITS.emailMax),
      ],
    }),
  });

  /** Resumen de las reglas que informó el backend en el último envío. */
  protected readonly summary = computed(() =>
    (this.serverErrors() ?? []).map((violation) => ({
      field: fieldKey(violation),
      issue: issueKey(violation),
    })),
  );

  /** Controles marcados con un rechazo del backend en el último envío. */
  private serverMarked: FormControl<string>[] = [];

  constructor() {
    effect(() => this.applyServerErrors(this.serverErrors()));
    effect(() => {
      if (this.emailTaken()) {
        this.markServerError('email', 'profile.personal.emailTaken');
        queueMicrotask(() =>
          this.host.nativeElement
            .querySelector<HTMLElement>('input[formControlName="email"]')
            ?.focus(),
        );
      }
    });
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this.clearServerMarks();
      this.edited.emit();
    });
  }

  ngOnInit(): void {
    const initial = this.initial();
    // Se parte de los valores vigentes, sin contarlo como edición.
    this.form.setValue({ fullName: initial.fullName, email: initial.email }, { emitEvent: false });
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
    this.submitted.emit({ fullName: value.fullName.trim(), email: value.email.trim() });
  }

  private applyServerErrors(violations: readonly AccountViolation[] | null): void {
    if (violations === null) {
      return;
    }
    for (const violation of violations) {
      const name = CONTROL_BY_FIELD[violation.field];
      if (name) {
        this.markServerError(name, issueKey(violation));
      }
    }
    queueMicrotask(() => {
      const summary = this.host.nativeElement.querySelector<HTMLElement>(
        '[data-testid="account-errors"]',
      );
      if (summary) {
        summary.focus();
      } else {
        this.focusFirstInvalid();
      }
    });
  }

  private markServerError(name: AccountControl, ruleKey: string): void {
    const control = this.form.controls[name];
    control.setErrors({ ...control.errors, profileRule: ruleKey });
    control.markAsTouched();
    this.serverMarked.push(control);
  }

  /** Al editar cualquier dato se retiran las marcas del backend. */
  private clearServerMarks(): void {
    const marked = this.serverMarked;
    this.serverMarked = [];
    for (const control of marked) {
      control.updateValueAndValidity({ emitEvent: false });
    }
  }

  private focusFirstInvalid(): void {
    queueMicrotask(() =>
      this.host.nativeElement.querySelector<HTMLElement>('input.ng-invalid')?.focus(),
    );
  }
}
