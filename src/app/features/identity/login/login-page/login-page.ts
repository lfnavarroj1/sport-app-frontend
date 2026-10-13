import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { toApiError } from '../../../../core/api/api-error';
import { SessionStore } from '../../../../core/session/session.store';
import { AuthShell } from '../../../../shared/ui/auth-shell/auth-shell';
import { FieldError } from '../../../../shared/forms/field-error/field-error';
import { LoginGateway } from '../login.gateway';
import { homeFor, UNAUTHORIZED_PATH } from '../../../../shell/navigation/navigation.registry';
import { LoginOutcome } from '../login.model';

/** Límites de `LoginRequest` en el contrato bff-web 0.10.0. */
const LIMITS = { emailMax: 254, passwordMax: 128 } as const;

/** Pantalla de inicio de sesión (HU003). */
@Component({
  selector: 'app-login-page',
  imports: [
    AuthShell,
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
  private readonly gateway = inject(LoginGateway);
  private readonly session = inject(SessionStore);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly passwordVisible = signal(false);
  protected readonly submitting = signal(false);
  private readonly outcome = signal<LoginOutcome | null>(null);

  /** La sesión anterior venció; se informa una sola vez. */
  protected readonly sessionExpired = this.session.lastEndReason() === 'expired';

  protected readonly invalidCredentials = computed(
    () => this.outcome()?.kind === 'invalid_credentials',
  );

  protected readonly tooManyAttempts = computed(() => {
    const outcome = this.outcome();
    if (outcome?.kind !== 'too_many_attempts') {
      return null;
    }
    const seconds = outcome.retryAfterSeconds;
    return { minutes: seconds === null ? null : Math.ceil(seconds / 60) };
  });

  protected readonly failure = computed(() => {
    const outcome = this.outcome();
    return outcome?.kind === 'failed' ? outcome.error : null;
  });

  protected readonly form = new FormGroup({
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email, Validators.maxLength(LIMITS.emailMax)],
    }),
    password: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(LIMITS.passwordMax)],
    }),
  });

  constructor() {
    this.session.acknowledgeEnd();
  }

  protected togglePasswordVisibility(): void {
    this.passwordVisible.update((visible) => !visible);
  }

  protected async submit(): Promise<void> {
    if (this.submitting()) {
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.focus('input.ng-invalid');
      return;
    }

    const { email, password } = this.form.getRawValue();
    this.submitting.set(true);
    this.outcome.set(null);
    let outcome: LoginOutcome;
    try {
      outcome = await this.gateway.login({ email: email.trim(), password });
    } catch (error) {
      outcome = { kind: 'failed', error: toApiError(error) };
    }
    this.submitting.set(false);

    if (outcome.kind === 'authenticated') {
      this.session.start(outcome.session);
      await this.router.navigateByUrl(homeFor(outcome.session.user.actorType));
      return;
    }
    if (outcome.kind === 'unauthorized_actor') {
      this.session.end();
      await this.router.navigateByUrl(UNAUTHORIZED_PATH);
      return;
    }

    this.outcome.set(outcome);
    if (outcome.kind === 'invalid_credentials') {
      // La contraseña rechazada no se conserva en el formulario.
      this.form.controls.password.reset();
      this.focus('input[formcontrolname="password"]');
    }
  }

  private focus(selector: string): void {
    queueMicrotask(() => this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus());
  }
}
