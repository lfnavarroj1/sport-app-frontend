import { ChangeDetectionStrategy, Component, ElementRef, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { FieldError } from '../../../../shared/forms/field-error/field-error';

/**
 * ESQUELETO de HU003 (iniciar sesión), solicitado como punto de entrada al
 * registro de HU001. No autentica: no existe contrato de autenticación en el
 * BFF web ni decisión de sesión/JWT (ADR-009). Valida la experiencia del
 * formulario y, al enviarlo, informa que el inicio de sesión aún no está
 * disponible, sin enviar ni conservar la contraseña.
 */
@Component({
  selector: 'app-login-page',
  imports: [
    FieldError,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    ReactiveFormsModule,
    RouterLink,
    TranslatePipe,
  ],
  templateUrl: './login-page.html',
  styleUrl: './login-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginPage {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly passwordVisible = signal(false);
  protected readonly notAvailable = signal(false);

  protected readonly form = new FormGroup({
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email],
    }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  protected togglePasswordVisibility(): void {
    this.passwordVisible.update((visible) => !visible);
  }

  protected submit(): void {
    this.notAvailable.set(false);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      queueMicrotask(() =>
        this.host.nativeElement.querySelector<HTMLElement>('input.ng-invalid')?.focus(),
      );
      return;
    }
    // HU003 pendiente: no hay operación de autenticación que invocar.
    this.form.controls.password.reset();
    this.notAvailable.set(true);
  }
}
