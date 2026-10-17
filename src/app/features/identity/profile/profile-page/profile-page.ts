import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  InjectionToken,
  Injector,
  LOCALE_ID,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { TranslatePipe } from '@ngx-translate/core';

import { ApiError, toApiError } from '../../../../core/api/api-error';
import { PROFILE_ERROR_CODES } from '../../../../core/api/bff-web/profile.api';
import { APP_CONFIG } from '../../../../core/config/app-config';
import { AsyncState } from '../../../../shared/ui/async-state/async-state';
import { ViewState, viewState } from '../../../../shared/ui/view-state';
import { DemographicForm } from '../demographic-form/demographic-form';
import { PhysiologicalForm } from '../physiological-form/physiological-form';
import { formatBirthDate, formatCountry, formatDecimal, formatInstant } from '../profile-format';
import { ProfileGateway } from '../profile.gateway';
import {
  AthleteProfile,
  DemographicDraft,
  DemographicProfile,
  PhysiologicalDraft,
  PhysiologicalProfile,
  ProfileViolation,
  SaveOutcome,
  newerSection,
} from '../profile.model';

const IDEMPOTENCY_KEY_REUSED = PROFILE_ERROR_CODES.idempotencyKeyReused;
/** Reintentos automáticos como máximo de un comando ante fallos transitorios. */
export const MAX_AUTOMATIC_RETRIES = 3;

/**
 * Esperas entre las recargas en segundo plano mientras la proyección no alcanza
 * la versión confirmada por el backend. Configurable para las pruebas.
 */
export const PROFILE_PROJECTION_RETRY_DELAYS_MS = new InjectionToken<readonly number[]>(
  'PROFILE_PROJECTION_RETRY_DELAYS_MS',
  { factory: () => [1_000, 2_000, 4_000] },
);

/** Mensaje de la sección tras el último comando. */
type SectionMessage =
  | { readonly kind: 'saved'; readonly created: boolean; readonly replayed: boolean }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'failure'; readonly error: ApiError };

/**
 * Estado de pantalla de una sección del perfil. Combina la proyección (eventual)
 * con la respuesta del último comando y recuerda la versión mínima que debe
 * mostrarse antes de permitir otro reemplazo.
 */
class SectionState<T extends { readonly version: number }> {
  readonly projected = signal<T | null>(null);
  /** Sección devuelta por el último comando confirmado. */
  readonly confirmed = signal<T | null>(null);
  /** Versión que el backend confirmó o informó como vigente; `null` si no exige ninguna. */
  readonly required = signal<number | null>(null);
  readonly mode = signal<'view' | 'edit'>('view');
  readonly submitting = signal(false);
  /** Reintento automático en curso (1 a 3), o `null`. */
  readonly retryAttempt = signal<number | null>(null);
  readonly message = signal<SectionMessage | null>(null);
  readonly violations = signal<readonly ProfileViolation[] | null>(null);
  /**
   * Clave del intento lógico en curso: se conserva en los reintentos y se
   * descarta tras un éxito, al editar los datos, tras un conflicto de versión o
   * cuando el BFF la rechaza por reutilizada.
   */
  idempotencyKey: string | null = null;

  readonly displayed = computed(() => newerSection(this.projected(), this.confirmed()));
  /** La versión vigente aún no se ve: no se permite reemplazarla a ciegas. */
  readonly pending = computed(() => {
    const required = this.required();
    return required !== null && (this.displayed()?.version ?? 0) < required;
  });

  readonly saved = computed(() => {
    const message = this.message();
    return message?.kind === 'saved' ? message : null;
  });
  readonly conflict = computed(() => this.message()?.kind === 'conflict');
  readonly failure = computed<ApiError | null>(() => {
    const message = this.message();
    return message?.kind === 'failure' ? message.error : null;
  });
}

/**
 * Mi perfil (HU005) en `/deportista/perfil`. El deportista registra o reemplaza
 * sus datos demográficos y fisiológicos y ve los valores que confirmó el backend,
 * incluido el IMC estimado que este calcula (CA1). Las reglas incumplidas llegan
 * del backend y se marcan por campo (CA2, CA3). Los valores de salud solo viven
 * en la memoria de la pantalla (CA4). Un `409 version_conflict` no sobrescribe:
 * se recarga el perfil y se muestran los valores vigentes (CA6). La proyección es
 * eventual: se conserva la respuesta del comando mientras no la alcance.
 */
@Component({
  selector: 'app-profile-page',
  imports: [
    AsyncState,
    DemographicForm,
    MatButtonModule,
    MatCardModule,
    PhysiologicalForm,
    TranslatePipe,
  ],
  templateUrl: './profile-page.html',
  styleUrl: './profile-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfilePage {
  private readonly gateway = inject(ProfileGateway);
  private readonly locale = inject(LOCALE_ID);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly projectionDelays = inject(PROFILE_PROJECTION_RETRY_DELAYS_MS);

  /** Versión vigente del consentimiento; `null` deja la sección fisiológica no disponible. */
  protected readonly consentVersion = inject(APP_CONFIG).healthDataConsentVersion;
  protected readonly maxRetries = MAX_AUTOMATIC_RETRIES;

  protected readonly state = signal<ViewState<AthleteProfile>>(viewState.loading());
  protected readonly demographic = new SectionState<DemographicProfile>();
  protected readonly physiological = new SectionState<PhysiologicalProfile>();

  /** Se agotaron las recargas automáticas o una recarga falló: se ofrece actualizar. */
  protected readonly projectionStalled = signal(false);
  protected readonly refreshing = signal(false);

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

  /** Carga inicial; también es el reintento de `<app-async-state>`. */
  protected async load(): Promise<void> {
    this.state.set(viewState.loading());
    try {
      const profile = await this.gateway.loadProfile();
      if (this.destroyed) {
        return;
      }
      this.applyProjection(profile);
      // Un perfil sin secciones es una invitación a registrar, no un estado vacío.
      this.state.set(viewState.fromData(profile, () => false));
    } catch (error) {
      if (!this.destroyed) {
        // Ningún error se presenta como un perfil vacío.
        this.state.set(viewState.fromError(error));
      }
    }
  }

  protected startEdit<T extends { readonly version: number }>(section: SectionState<T>): void {
    if (section.pending() || section.submitting()) {
      return;
    }
    section.idempotencyKey = null;
    section.message.set(null);
    section.violations.set(null);
    section.mode.set('edit');
  }

  protected cancelEdit<T extends { readonly version: number }>(section: SectionState<T>): void {
    section.idempotencyKey = null;
    section.violations.set(null);
    section.message.set(null);
    section.mode.set('view');
  }

  /** El deportista cambió los datos: el siguiente envío es un intento nuevo. */
  protected onEdited<T extends { readonly version: number }>(section: SectionState<T>): void {
    section.idempotencyKey = null;
  }

  protected saveDemographic(draft: DemographicDraft): Promise<void> {
    return this.save(this.demographic, 'demographic', (expected, key, onRetry) =>
      this.gateway.saveDemographic(draft, expected, key, onRetry),
    );
  }

  protected savePhysiological(draft: PhysiologicalDraft): Promise<void> {
    return this.save(this.physiological, 'physiological', (expected, key, onRetry) =>
      this.gateway.savePhysiological(draft, expected, key, onRetry),
    );
  }

  /** Actualización manual cuando la proyección sigue atrasada. */
  protected refreshNow(): void {
    this.refreshRound = 0;
    void this.refresh();
  }

  protected failureMessage(error: ApiError): string {
    return error.code === IDEMPOTENCY_KEY_REUSED
      ? 'profile.errors.idempotencyKeyReused'
      : `common.errors.${error.kind}`;
  }

  /** Tras agotar los reintentos automáticos, volver a guardar no duplica el registro. */
  protected retryable(error: ApiError): boolean {
    return error.kind === 'offline' || error.kind === 'server';
  }

  protected birthDate(date: string): string {
    return formatBirthDate(date, this.locale);
  }

  protected instant(iso: string): string {
    return formatInstant(iso, this.locale);
  }

  protected decimal(text: string): string {
    return formatDecimal(text, this.locale);
  }

  protected country(code: string): string {
    return formatCountry(code, this.locale);
  }

  private async save<T extends { readonly version: number }>(
    section: SectionState<T>,
    prefix: 'demographic' | 'physiological',
    send: (
      expectedVersion: number | null,
      idempotencyKey: string,
      onRetry: (attempt: number) => void,
    ) => Promise<SaveOutcome<T>>,
  ): Promise<void> {
    if (section.submitting()) {
      return;
    }
    section.idempotencyKey ??= crypto.randomUUID();
    section.submitting.set(true);
    section.retryAttempt.set(null);
    section.message.set(null);
    section.violations.set(null);

    let outcome: SaveOutcome<T>;
    try {
      outcome = await send(
        section.displayed()?.version ?? null,
        section.idempotencyKey,
        (attempt) => section.retryAttempt.set(attempt),
      );
    } catch (error) {
      outcome = { kind: 'failed', error: toApiError(error) };
    }
    if (this.destroyed) {
      return;
    }
    section.submitting.set(false);
    section.retryAttempt.set(null);

    switch (outcome.kind) {
      case 'saved':
        section.idempotencyKey = null;
        section.confirmed.set(outcome.section);
        section.required.set(outcome.section.version);
        section.mode.set('view');
        section.message.set({
          kind: 'saved',
          created: outcome.created,
          replayed: outcome.replayed,
        });
        this.focus(`${prefix}-saved`);
        break;
      case 'invalid':
        // El formulario sigue abierto y marca los campos; la clave se conserva.
        section.violations.set(outcome.violations);
        break;
      case 'conflict':
        // No se sobrescribe: se muestran los valores vigentes cuando la proyección los traiga.
        section.idempotencyKey = null;
        section.confirmed.set(null);
        section.required.set(outcome.currentVersion);
        section.mode.set('view');
        section.message.set({ kind: 'conflict' });
        this.focus(`${prefix}-conflict`);
        this.refreshRound = 0;
        void this.refresh();
        break;
      case 'failed':
        if (outcome.error.code === IDEMPOTENCY_KEY_REUSED) {
          section.idempotencyKey = null;
        }
        section.message.set({ kind: 'failure', error: outcome.error });
        this.focus(`${prefix}-error`);
        break;
    }
  }

  /**
   * Recarga en segundo plano: actualiza la proyección sin volver al indicador de
   * carga. Mientras alguna sección no alcance su versión, vuelve a intentarlo con
   * las esperas configuradas; al agotarlas, o si la recarga falla, se conserva lo
   * mostrado y se ofrece actualizar.
   */
  private async refresh(): Promise<void> {
    this.clearRefreshTimer();
    const generation = ++this.refreshGeneration;
    this.refreshing.set(true);
    let failed = false;
    try {
      const profile = await this.gateway.loadProfile();
      if (this.destroyed || generation !== this.refreshGeneration) {
        return;
      }
      this.applyProjection(profile);
    } catch {
      failed = true;
    }
    if (this.destroyed || generation !== this.refreshGeneration) {
      return;
    }
    this.refreshing.set(false);

    const pending = this.demographic.pending() || this.physiological.pending();
    if (failed) {
      this.projectionStalled.set(true);
    } else if (!pending) {
      this.projectionStalled.set(false);
    } else if (this.refreshRound < this.projectionDelays.length) {
      const wait = this.projectionDelays[this.refreshRound++];
      this.refreshTimer = setTimeout(() => void this.refresh(), wait);
    } else {
      this.projectionStalled.set(true);
    }
  }

  private applyProjection(profile: AthleteProfile): void {
    this.demographic.projected.set(profile.demographic);
    this.physiological.projected.set(profile.physiological);
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
