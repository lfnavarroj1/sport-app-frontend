import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';

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

/** Motivo por el que terminó la última sesión, para informarlo al usuario. */
export type SessionEndReason = 'expired';

/**
 * Sesión autenticada de la pestaña (HU003). Solo vive en memoria: el access token
 * nunca se escribe en localStorage, sessionStorage, cookies accesibles ni logs, y
 * el refresh token no llega a la aplicación (decisión 2026-10-10: cookie HttpOnly
 * del BFF). Al vencer el access token la sesión termina.
 */
@Injectable({ providedIn: 'root' })
export class SessionStore {
  private readonly current = signal<Session | null>(null);
  private readonly endReason = signal<SessionEndReason | null>(null);
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;

  readonly user = computed(() => this.current()?.user ?? null);
  readonly isAuthenticated = computed(() => this.current() !== null);
  readonly lastEndReason = this.endReason.asReadonly();

  constructor() {
    inject(DestroyRef).onDestroy(() => this.cancelExpiry());
  }

  /** Access token vigente para llamadas autenticadas al BFF, o `null`. */
  accessToken(): string | null {
    const session = this.current();
    if (!session || Date.now() >= session.expiresAt) {
      return null;
    }
    return session.accessToken;
  }

  start(session: Session): void {
    this.cancelExpiry();
    this.endReason.set(null);
    this.current.set(session);
    this.expiryTimer = setTimeout(() => this.end('expired'), session.expiresAt - Date.now());
  }

  /** Termina la sesión y descarta el access token de la memoria. */
  end(reason: SessionEndReason | null = null): void {
    this.cancelExpiry();
    this.current.set(null);
    this.endReason.set(reason);
  }

  /** Marca como informado el motivo del último cierre. */
  acknowledgeEnd(): void {
    this.endReason.set(null);
  }

  private cancelExpiry(): void {
    if (this.expiryTimer !== null) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = null;
    }
  }
}
