import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal, viewChild } from '@angular/core';
import {
  FormControl,
  FormGroup,
  FormGroupDirective,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { TranslatePipe } from '@ngx-translate/core';

import { ApiError } from '../../../../core/api/api-error';
import {
  GRANT_AUTHORIZATION_ERROR_CODES,
  TRAINING_PLAN_LIMITS,
} from '../../../../core/api/bff-web/training.api';
import { FieldError } from '../../../../shared/forms/field-error/field-error';
import { AuthorizationsGateway } from '../authorizations.gateway';
import { TrainingAuthorization } from '../authorizations.model';

/** Estado de una autorización gestionada en esta visita. */
export type EntryStatus = 'active' | 'confirming' | 'revoking' | 'revoked';

export interface AuthorizationEntry {
  readonly authorization: TrainingAuthorization;
  readonly status: EntryStatus;
  readonly error: ApiError | null;
}

/** Último resultado de autorizar, anunciado a tecnologías de asistencia. */
interface GrantNotice {
  readonly email: string;
  readonly alreadyActive: boolean;
}

const CAPABILITY_REQUIRED = GRANT_AUTHORIZATION_ERROR_CODES.capabilityRequired;

/**
 * «Planes de entrenamiento» del deportista (HU010, capacidad
 * `training.plan.manage`): autoriza por correo exacto a un profesional para que
 * le cree y asigne planes, y revoca esa autorización. Solo se muestran las
 * autorizaciones confirmadas por el BFF en esta visita: el contrato 0.12.0 no
 * ofrece una consulta de las autorizaciones existentes, y no se inventa.
 */
@Component({
  selector: 'app-athlete-authorizations-page',
  imports: [
    DatePipe,
    FieldError,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule,
    TranslatePipe,
  ],
  templateUrl: './athlete-authorizations-page.html',
  styleUrls: ['../../training-page.scss', './athlete-authorizations-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AthleteAuthorizationsPage {
  private readonly gateway = inject(AuthorizationsGateway);

  protected readonly form = new FormGroup({
    professionalEmail: new FormControl('', {
      nonNullable: true,
      validators: [
        Validators.required,
        Validators.email,
        Validators.maxLength(TRAINING_PLAN_LIMITS.emailMax),
      ],
    }),
  });
  protected readonly email = this.form.controls.professionalEmail;
  private readonly formDirective = viewChild.required(FormGroupDirective);

  protected readonly submitting = signal(false);
  protected readonly grantFailure = signal<ApiError | null>(null);
  protected readonly notice = signal<GrantNotice | null>(null);
  protected readonly entries = signal<readonly AuthorizationEntry[]>([]);

  protected async grant(): Promise<void> {
    if (this.submitting()) {
      return;
    }
    if (this.email.invalid) {
      this.email.markAsTouched();
      return;
    }
    const professionalEmail = this.email.value.trim();
    this.submitting.set(true);
    this.grantFailure.set(null);
    this.notice.set(null);

    const outcome = await this.gateway.grant(professionalEmail);
    this.submitting.set(false);

    switch (outcome.kind) {
      case 'granted': {
        const { authorization } = outcome;
        this.entries.update((entries) => [
          { authorization, status: 'active', error: null },
          ...entries.filter(
            (entry) => entry.authorization.professionalId !== authorization.professionalId,
          ),
        ]);
        this.notice.set({ email: professionalEmail, alreadyActive: authorization.alreadyActive });
        // También reinicia el estado «enviado»: el campo vacío no se marca como error.
        this.formDirective().resetForm();
        break;
      }
      case 'professional_not_found':
        this.markEmailError({ professionalNotFound: true });
        break;
      case 'invalid_email':
        this.markEmailError({ email: true });
        break;
      case 'failed':
        this.grantFailure.set(outcome.error);
        break;
    }
  }

  protected askRevoke(professionalId: string): void {
    this.updateEntry(professionalId, { status: 'confirming', error: null });
  }

  protected cancelRevoke(professionalId: string): void {
    this.updateEntry(professionalId, { status: 'active' });
  }

  protected async revoke(professionalId: string): Promise<void> {
    const entry = this.entries().find(
      (item) => item.authorization.professionalId === professionalId,
    );
    if (entry === undefined || entry.status === 'revoking') {
      return;
    }
    this.updateEntry(professionalId, { status: 'revoking', error: null });
    const outcome = await this.gateway.revoke(professionalId);
    // Solo se marca revocada con la confirmación del BFF; si falla sigue activa.
    this.updateEntry(
      professionalId,
      outcome.kind === 'revoked'
        ? { status: 'revoked', error: null }
        : { status: 'confirming', error: outcome.error },
    );
  }

  protected failureMessage(error: ApiError): string {
    return error.code === CAPABILITY_REQUIRED
      ? 'training.authorizations.errors.capabilityRequired'
      : `common.errors.${error.kind}`;
  }

  private markEmailError(error: Record<string, boolean>): void {
    this.email.setErrors({ ...this.email.errors, ...error });
    this.email.markAsTouched();
  }

  private updateEntry(
    professionalId: string,
    change: Partial<Pick<AuthorizationEntry, 'status' | 'error'>>,
  ): void {
    this.entries.update((entries) =>
      entries.map((entry) =>
        entry.authorization.professionalId === professionalId ? { ...entry, ...change } : entry,
      ),
    );
  }
}
