import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';

import { SessionRefresher } from './session-refresher';

export type ActorType = 'athlete' | 'organizer' | 'service_provider';

export interface SessionUser {
  readonly id: string;
  readonly fullName: string;
  readonly email: string;
  readonly actorType: ActorType;
}

export interface Session {
  readonly user: SessionUser;
  readonly accessToken: string;
  /** Instante (epoch ms) en que vence el access token. */
  readonly expiresAt: number;
}

/**
 * Motivo por el que terminó la última sesión, para informarlo al usuario:
 * `expired` (vencida o rechazada por el BFF), `unauthorized_actor` (el BFF no
 * admite el tipo de actor, HU003 CA10), `logged_out` (el usuario cerró sesión y
 * el BFF confirmó la revocación, HU004) o `logged_out_unconfirmed` (el BFF borró
 * la cookie, pero no pudo confirmar la revocación remota: `503`/`504`, HU004).
 */
export type SessionEndReason =
  'expired' | 'unauthorized_actor' | 'logged_out' | 'logged_out_unconfirmed';

/** Anticipación con que se renueva el access token antes de su vencimiento. */
export const RENEWAL_LEAD_MS = 60_000;
/** Espera entre reintentos de renovación cuando el BFF no está disponible. */
export const RENEWAL_RETRY_MS = 15_000;

/**
 * Sesión autenticada de la pestaña (HU003). El access token solo vive en memoria:
 * nunca se escribe en localStorage, sessionStorage, cookies accesibles ni logs. El
 * refresh token no llega a la aplicación: viaja en la cookie HttpOnly del BFF
 * (decisión 2026-10-10, bff-web 0.4.0+), y `SessionRefresher` la usa para
 * renovar el access token antes de que venza y para recuperar la sesión al
 * recargar la pestaña. Si la renovación es rechazada, la sesión termina.
 */
@Injectable({ providedIn: 'root' })
export class SessionStore {
  private readonly refresher = inject(SessionRefresher, { optional: true });
  private readonly current = signal<Session | null>(null);
  private readonly endReason = signal<SessionEndReason | null>(null);
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private renewalTimer: ReturnType<typeof setTimeout> | null = null;
  private restoration: Promise<void> | null = null;

  /** Nombre y correo confirmados por HU002 después de iniciar la sesión vigente. */
  private readonly userChanges = signal<Pick<SessionUser, 'fullName' | 'email'> | null>(null);

  readonly user = computed(() => {
    const user = this.current()?.user ?? null;
    const changes = this.userChanges();
    return user !== null && changes !== null ? { ...user, ...changes } : user;
  });
  readonly isAuthenticated = computed(() => this.current() !== null);
  readonly lastEndReason = this.endReason.asReadonly();

  constructor() {
    inject(DestroyRef).onDestroy(() => this.cancelTimers());
  }

  /** Access token vigente para llamadas autenticadas al BFF, o `null`. */
  accessToken(): string | null {
    const session = this.current();
    if (!session || Date.now() >= session.expiresAt) {
      return null;
    }
    return session.accessToken;
  }

  /**
   * Intenta recuperar con la cookie la sesión de una carga anterior de la página.
   * Se intenta una sola vez por carga; las llamadas siguientes devuelven el mismo
   * resultado. Nunca rechaza: sin cookie válida simplemente no hay sesión.
   */
  restore(): Promise<void> {
    this.restoration ??= this.attemptRestore();
    return this.restoration;
  }

  start(session: Session): void {
    this.cancelTimers();
    this.endReason.set(null);
    // La sesión nueva o renovada trae el nombre y el correo vigentes del BFF.
    this.userChanges.set(null);
    this.current.set(session);
    const lifetime = session.expiresAt - Date.now();
    this.expiryTimer = setTimeout(() => this.end('expired'), lifetime);
    if (this.refresher) {
      const lead = Math.min(RENEWAL_LEAD_MS, lifetime / 2);
      this.renewalTimer = setTimeout(() => void this.renew(), lifetime - lead);
    }
  }

  /**
   * Muestra el nombre y el correo que el backend confirmó al editar la cuenta
   * (HU002) sin cerrar la sesión: no cambia el access token, su vencimiento ni
   * la renovación. Sin sesión vigente no hace nada.
   */
  updateUser(changes: Pick<SessionUser, 'fullName' | 'email'>): void {
    if (this.current() !== null) {
      this.userChanges.set({ fullName: changes.fullName, email: changes.email });
    }
  }

  /** Termina la sesión y descarta el access token de la memoria. */
  end(reason: SessionEndReason | null = null): void {
    this.cancelTimers();
    this.userChanges.set(null);
    this.current.set(null);
    this.endReason.set(reason);
  }

  /** Marca como informado el motivo del último cierre. */
  acknowledgeEnd(): void {
    this.endReason.set(null);
  }

  private async attemptRestore(): Promise<void> {
    if (!this.refresher || this.current() !== null) {
      return;
    }
    const outcome = await this.refresher.refresh();
    // Si mientras tanto se inició sesión con el formulario, esa sesión prevalece.
    if (outcome.kind === 'renewed' && this.current() === null) {
      this.start(outcome.session);
    }
  }

  private async renew(): Promise<void> {
    this.renewalTimer = null;
    const session = this.current();
    if (!this.refresher || session === null) {
      return;
    }
    const outcome = await this.refresher.refresh();
    if (this.current() !== session) {
      return; // La sesión terminó o fue reemplazada mientras se renovaba.
    }

    if (outcome.kind === 'renewed') {
      // La cookie es del navegador: si otra pestaña inició sesión con otra cuenta,
      // esta pestaña no adopta esa identidad.
      if (outcome.session.user.id === session.user.id) {
        this.start(outcome.session);
      } else {
        this.end('expired');
      }
    } else if (outcome.kind === 'rejected') {
      this.end('expired');
    } else if (session.expiresAt - Date.now() > RENEWAL_RETRY_MS) {
      this.renewalTimer = setTimeout(() => void this.renew(), RENEWAL_RETRY_MS);
    }
    // Sin más reintentos posibles, la sesión termina al vencer el access token.
  }

  private cancelTimers(): void {
    if (this.expiryTimer !== null) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = null;
    }
    if (this.renewalTimer !== null) {
      clearTimeout(this.renewalTimer);
      this.renewalTimer = null;
    }
  }
}
