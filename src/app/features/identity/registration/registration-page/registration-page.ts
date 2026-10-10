import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { TranslatePipe } from '@ngx-translate/core';

import { toApiError } from '../../../../core/api/api-error';
import { AsyncState } from '../../../../shared/ui/async-state/async-state';
import { ViewState, viewState } from '../../../../shared/ui/view-state';
import { RegistrationForm } from '../registration-form/registration-form';
import { RegistrationGateway } from '../registration.gateway';
import {
  RegistrationDraft,
  RegistrationOptions,
  RegistrationOutcome,
  RegistrationServerErrors,
} from '../registration.model';

type SubmissionState =
  | { readonly status: 'idle' }
  | { readonly status: 'submitting' }
  | { readonly status: 'done'; readonly outcome: RegistrationOutcome };

/** Pantalla de registro de usuario (HU001). */
@Component({
  selector: 'app-registration-page',
  imports: [AsyncState, MatCardModule, RegistrationForm, TranslatePipe],
  templateUrl: './registration-page.html',
  styleUrl: './registration-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RegistrationPage {
  private readonly gateway = inject(RegistrationGateway);

  /**
   * Clave de idempotencia del intento lógico en curso: se conserva en los
   * reintentos y se descarta cuando el usuario cambia los datos o el registro
   * termina con éxito (CA5).
   */
  private idempotencyKey: string | null = null;

  protected readonly options = signal<ViewState<RegistrationOptions>>(viewState.loading());
  private readonly submission = signal<SubmissionState>({ status: 'idle' });

  protected readonly loadedOptions = computed(() => {
    const state = this.options();
    return state.status === 'success' ? state.data : null;
  });

  protected readonly submitting = computed(() => this.submission().status === 'submitting');

  private readonly outcome = computed(() => {
    const submission = this.submission();
    return submission.status === 'done' ? submission.outcome : null;
  });

  protected readonly registered = computed(() => {
    const outcome = this.outcome();
    return outcome?.kind === 'registered' ? outcome : null;
  });

  protected readonly failure = computed(() => {
    const outcome = this.outcome();
    return outcome?.kind === 'failed' ? outcome.error : null;
  });

  protected readonly serverErrors = computed<RegistrationServerErrors | null>(() => {
    const outcome = this.outcome();
    if (outcome?.kind === 'email_taken') {
      return { emailTaken: true, invalidFields: [] };
    }
    if (outcome?.kind === 'invalid') {
      return { emailTaken: false, invalidFields: outcome.fields };
    }
    return null;
  });

  private readonly successHeading = viewChild<ElementRef<HTMLElement>>('successHeading');

  constructor() {
    effect(() => this.successHeading()?.nativeElement.focus());
    void this.loadOptions();
  }

  protected async loadOptions(): Promise<void> {
    this.options.set(viewState.loading());
    try {
      const options = await this.gateway.loadOptions();
      this.options.set(viewState.fromData(options, (data) => data.actorTypes.length === 0));
    } catch (error) {
      this.options.set(viewState.fromError(error));
    }
  }

  protected async register(draft: RegistrationDraft): Promise<void> {
    if (this.submitting()) {
      return;
    }
    this.idempotencyKey ??= crypto.randomUUID();
    this.submission.set({ status: 'submitting' });

    let outcome: RegistrationOutcome;
    try {
      outcome = await this.gateway.register(draft, this.idempotencyKey);
    } catch (error) {
      outcome = { kind: 'failed', error: toApiError(error) };
    }

    if (outcome.kind === 'registered') {
      this.idempotencyKey = null;
    }
    this.submission.set({ status: 'done', outcome });
  }

  protected onEdited(): void {
    this.idempotencyKey = null;
  }
}
