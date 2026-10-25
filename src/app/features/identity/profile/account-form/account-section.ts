import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  InjectionToken,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { TranslatePipe } from '@ngx-translate/core';

import { ApiError, toApiError } from '../../../../core/api/api-error';
import { ACCOUNT_ERROR_CODES } from '../../../../core/api/bff-web/account.api';
import { SessionStore } from '../../../../core/session/session.store';
import { AsyncState } from '../../../../shared/ui/async-state/async-state';
import { ViewState, viewState } from '../../../../shared/ui/view-state';
import { AccountForm } from './account-form';
import { AccountGateway } from './account.gateway';
import {
  Account,
  AccountDraft,
  AccountSaveOutcome,
  AccountViolation,
  newerAccount,
} from './account.model';

/** Reintentos automáticos como máximo del comando ante fallos transitorios. */
export const ACCOUNT_MAX_AUTOMATIC_RETRIES = 3;

/**
 * Esperas entre las recargas en segundo plano mientras la proyección no alcanza
 * la versión vigente que informó el backend. Configurable para las pruebas.
 */
export const ACCOUNT_PROJECTION_RETRY_DELAYS_MS = new InjectionToken<readonly number[]>(
  'ACCOUNT_PROJECTION_RETRY_DELAYS_MS',
  { factory: () => [1_000, 2_000, 4_000] },
);

/** Mensaje de la sección tras el último comando. */
type SectionMessage =
  | { readonly kind: 'saved'; readonly replayed: boolean }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'failure'; readonly error: ApiError };

/**
 * «Datos personales» de «Mi perfil» (HU002, ADR-035) para los tres actores. El
 * usuario edita su nombre y su correo con la versión vigente y ve los valores
 * que confirmó el backend (CA1); tras el `200`, la cabecera muestra el nombre
 * nuevo sin cerrar la sesión (CA6). Un correo de otra cuenta se marca en el
 * campo sin más detalle (CA3). Un `409 version_conflict` no sobrescribe: se
 * recarga la cuenta y se muestran los valores vigentes (CA4). La proyección
 * (`GET`) es eventual: se conserva la respuesta del comando mientras no la
 * alcance. Los valores solo viven en la memoria de la pantalla.
 */
@Component({
  selector: 'app-account-section',
  imports: [AccountForm, AsyncState, MatButtonModule, TranslatePipe],
  templateUrl: './account-section.html',
  styleUrl: './account-section.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountSection {
  private readonly gateway = inject(AccountGateway);
  private readonly session = inject(SessionStore);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly projectionDelays = inject(ACCOUNT_PROJECTION_RETRY_DELAYS_MS);

  protected readonly maxRetries = ACCOUNT_MAX_AUTOMATIC_RETRIES;

  /** Carga inicial; `user_not_found` (cuenta aún no proyectada) tiene su propio aviso. */
  protected readonly state = signal<ViewState<Account>>(viewState.loading());
  protected readonly notProjected = signal(false);

  private readonly projected = signal<Account | null>(null);
  /** Cuenta devuelta por el último comando confirmado. */
  private readonly confirmed = signal<Account | null>(null);
  /** Versión que el backend confirmó o informó como vigente; `null` si no exige ninguna. */
  private readonly required = signal<number | null>(null);

  protected readonly mode = signal<'view' | 'edit'>('view');
  protected readonly submitting = signal(false);
  /** Reintento automático en curso (1 a 3), o `null`. */
  protected readonly retryAttempt = signal<number | null>(null);
  protected readonly message = signal<SectionMessage | null>(null);
  protected readonly violations = signal<readonly AccountViolation[] | null>(null);
  protected readonly emailTaken = signal(false);
  /** Se agotaron las recargas automáticas o una recarga falló: se ofrece actualizar. */
  protected readonly projectionStalled = signal(false);
  protected readonly refreshing = signal(false);

  protected readonly displayed = computed(() => newerAccount(this.projected(), this.confirmed()));
  /** La versión vigente aún no se ve: no se permite editar sobre valores obsoletos. */
  protected readonly pending = computed(() => {
    const required = this.required();
    return required !== null && (this.displayed()?.version ?? 0) < required;
  });
  protected readonly saved = computed(() => {
    const message = this.message();
    return message?.kind === 'saved' ? message : null;
  });
  protected readonly conflict = computed(() => this.message()?.kind === 'conflict');
  protected readonly failure = computed<ApiError | null>(() => {
    const message = this.message();
    return message?.kind === 'failure' ? message.error : null;
  });

  /**
   * Clave del intento lógico en curso: se conserva en los reintentos y se
   * descarta tras un éxito, al editar los datos, tras un conflicto o cuando el
   * BFF la rechaza por reutilizada.
   */
  private idempotencyKey: string | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshRound = 0;
  private refreshGeneration = 0;
  private destroyed = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.clearRefreshTimer();
    });
    void this.load();
  }

  /** Carga inicial; también es el reintento de los errores recuperables. */
  protected async load(): Promise<void> {
    this.state.set(viewState.loading());
    this.notProjected.set(false);
    try {
      const account = await this.gateway.loadAccount();
      if (this.destroyed) {
        return;
      }
      this.projected.set(account);
      this.state.set(viewState.fromData(account, () => false));
    } catch (error) {
      if (this.destroyed) {
        return;
      }
      // Ningún error se presenta como una cuenta vacía.
      const apiError = toApiError(error);
      this.notProjected.set(apiError.code === ACCOUNT_ERROR_CODES.userNotFound);
      this.state.set({ status: 'error', error: apiError });
    }
  }

  protected startEdit(): void {
    if (this.pending() || this.submitting()) {
      return;
    }
    this.idempotencyKey = null;
    this.message.set(null);
    this.violations.set(null);
    this.emailTaken.set(false);
    this.mode.set('edit');
  }

  protected cancelEdit(): void {
    this.idempotencyKey = null;
    this.message.set(null);
    this.violations.set(null);
    this.emailTaken.set(false);
    this.mode.set('view');
  }

  /** El usuario cambió los datos: el siguiente envío es un intento nuevo. */
  protected onEdited(): void {
    this.idempotencyKey = null;
    this.emailTaken.set(false);
  }

  /** Actualización manual cuando la proyección sigue atrasada. */
  protected refreshNow(): void {
    this.refreshRound = 0;
    void this.refresh();
  }

  protected failureMessage(error: ApiError): string {
    return error.code === ACCOUNT_ERROR_CODES.idempotencyKeyReused
      ? 'profile.errors.idempotencyKeyReused'
      : `common.errors.${error.kind}`;
  }

  /** Tras agotar los reintentos automáticos, volver a guardar no duplica el cambio. */
  protected retryable(error: ApiError): boolean {
    return error.kind === 'offline' || error.kind === 'server';
  }

  protected async save(draft: AccountDraft): Promise<void> {
    const current = this.displayed();
    if (this.submitting() || current === null) {
      return;
    }
    this.idempotencyKey ??= crypto.randomUUID();
    this.submitting.set(true);
    this.retryAttempt.set(null);
    this.message.set(null);
    this.violations.set(null);
    this.emailTaken.set(false);

    let outcome: AccountSaveOutcome;
    try {
      outcome = await this.gateway.saveAccount(
        draft,
        current.version,
        this.idempotencyKey,
        (attempt) => this.retryAttempt.set(attempt),
      );
    } catch (error) {
      outcome = { kind: 'failed', error: toApiError(error) };
    }
    if (this.destroyed) {
      return;
    }
    this.submitting.set(false);
    this.retryAttempt.set(null);

    switch (outcome.kind) {
      case 'saved':
        this.idempotencyKey = null;
        this.confirmed.set(outcome.account);
        this.required.set(outcome.account.version);
        // La cabecera muestra lo confirmado sin cerrar la sesión (CA6).
        this.session.updateUser({
          fullName: outcome.account.fullName,
          email: outcome.account.email,
        });
        this.mode.set('view');
        this.message.set({ kind: 'saved', replayed: outcome.replayed });
        this.focus('account-saved');
        break;
      case 'invalid':
        // El formulario sigue abierto y marca los campos; la clave se conserva.
        this.violations.set(outcome.violations);
        break;
      case 'email_taken':
        // Se conserva el valor anterior; otro correo es un intento nuevo (CA3).
        this.idempotencyKey = null;
        this.emailTaken.set(true);
        break;
      case 'conflict':
        // No se sobrescribe: se muestran los valores vigentes cuando la proyección los traiga (CA4).
        this.idempotencyKey = null;
        this.confirmed.set(null);
        this.required.set(outcome.currentVersion);
        this.mode.set('view');
        this.message.set({ kind: 'conflict' });
        this.focus('account-conflict');
        this.refreshRound = 0;
        void this.refresh();
        break;
      case 'failed':
        if (outcome.error.code === ACCOUNT_ERROR_CODES.idempotencyKeyReused) {
          this.idempotencyKey = null;
        }
        this.message.set({ kind: 'failure', error: outcome.error });
        this.focus('account-error');
        break;
    }
  }

  /**
   * Recarga en segundo plano: actualiza la proyección sin volver al indicador de
   * carga. Mientras no alcance la versión vigente, vuelve a intentarlo con las
   * esperas configuradas; al agotarlas, o si la recarga falla, se conserva lo
   * mostrado y se ofrece actualizar.
   */
  private async refresh(): Promise<void> {
    this.clearRefreshTimer();
    const generation = ++this.refreshGeneration;
    this.refreshing.set(true);
    let failed = false;
    try {
      const account = await this.gateway.loadAccount();
      if (this.destroyed || generation !== this.refreshGeneration) {
        return;
      }
      this.projected.set(account);
    } catch {
      failed = true;
    }
    if (this.destroyed || generation !== this.refreshGeneration) {
      return;
    }
    this.refreshing.set(false);

    if (failed) {
      this.projectionStalled.set(true);
    } else if (!this.pending()) {
      this.projectionStalled.set(false);
    } else if (this.refreshRound < this.projectionDelays.length) {
      const wait = this.projectionDelays[this.refreshRound++];
      this.refreshTimer = setTimeout(() => void this.refresh(), wait);
    } else {
      this.projectionStalled.set(true);
    }
  }

  private clearRefreshTimer(): void {
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /** Lleva el foco al mensaje del resultado, una vez presente en la vista. */
  private focus(testId: string): void {
    afterNextRender(
      () =>
        this.host.nativeElement.querySelector<HTMLElement>(`[data-testid="${testId}"]`)?.focus(),
      { injector: this.injector },
    );
  }
}
