import { HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, Injectable, effect, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import {
  BffWebCapabilitiesApi,
  CapabilitiesResponseDto,
  GET_CAPABILITIES_ERROR_CODES,
  SubscriptionStatusDto,
} from '../api/bff-web/capabilities.api';
import { readErrorResponse } from '../api/bff-web/contract';
import { ViewState, viewState } from '../../shared/ui/view-state';
import { ActorType, SessionStore } from './session.store';

/**
 * Lo que la sesión puede ver en la web, según `GET /v1/me/capabilities`
 * (ADR-024, ADR-025): permisos estables del actor y capacidades vigentes del plan
 * del deportista. Mejora la navegación; el BFF y los servicios vuelven a validar.
 */
export interface SessionAccess {
  readonly actorType: ActorType;
  readonly subscriptionStatus: SubscriptionStatusDto;
  readonly permissions: ReadonlySet<string>;
  readonly capabilities: ReadonlySet<string>;
}

/** Espera entre consultas mientras la suscripción gratuita se activa. */
export const PROVISIONING_RECHECK_MS = 3_000;
/** Consultas automáticas como máximo durante `PROVISIONING`; después, solo manual. */
export const PROVISIONING_MAX_RECHECKS = 10;

/**
 * Permisos y capacidades de la sesión vigente (HU003 CA7–CA10). Se consultan una
 * vez por usuario y se descartan cuando la sesión termina o cambia de cuenta.
 *
 * - `PROVISIONING`: no concede capacidades; se vuelve a consultar sola unas veces.
 * - `401 invalid_access_token`: la sesión termina como vencida.
 * - `403 unsupported_actor_type`: la sesión termina sin asumir un rol (CA10).
 * - `503`, sin conexión u otro fallo: error trazable con reintento; nunca se
 *   interpreta como plan gratuito ni como permisos vacíos confirmados.
 */
@Injectable({ providedIn: 'root' })
export class SessionAccessStore {
  private readonly api = inject(BffWebCapabilitiesApi);
  private readonly session = inject(SessionStore);
  private readonly state = signal<ViewState<SessionAccess> | null>(null);
  private loadedFor: string | null = null;
  private generation = 0;
  private recheckTimer: ReturnType<typeof setTimeout> | null = null;
  private rechecks = 0;

  /** `null` sin sesión; si no, el estado de la consulta. */
  readonly view = this.state.asReadonly();

  constructor() {
    effect(() => {
      const userId = this.session.user()?.id ?? null;
      if (userId !== this.loadedFor) {
        this.reset();
      }
    });
    inject(DestroyRef).onDestroy(() => this.cancelRecheck());
  }

  /** Consulta la vista si aún no se pidió para el usuario de la sesión vigente. */
  ensureLoaded(): void {
    const user = this.session.user();
    if (user !== null && this.loadedFor !== user.id) {
      this.loadedFor = user.id;
      this.rechecks = 0;
      void this.load();
    }
  }

  /** Vuelve a consultar (reintento manual o fin del aprovisionamiento). */
  reload(): void {
    if (this.session.user() !== null) {
      this.rechecks = 0;
      void this.load();
    }
  }

  private async load(): Promise<void> {
    const token = this.session.accessToken();
    const user = this.session.user();
    if (token === null || user === null) {
      return;
    }
    this.cancelRecheck();
    const generation = ++this.generation;
    if (this.state()?.status !== 'success') {
      this.state.set(viewState.loading());
    }

    let response: CapabilitiesResponseDto;
    try {
      response = await firstValueFrom(this.api.getCapabilities(token));
    } catch (error) {
      if (generation === this.generation) {
        this.handleFailure(error);
      }
      return;
    }
    if (generation !== this.generation) {
      return; // La sesión terminó o cambió mientras se consultaba.
    }
    if (response.actor_type !== user.actorType) {
      // La vista no corresponde a la sesión: no se concede nada ni se asume un rol.
      this.session.end('unauthorized_actor');
      return;
    }
    this.state.set({ status: 'success', data: toAccess(response) });
    if (response.subscription_status === 'PROVISIONING') {
      this.scheduleRecheck();
    }
  }

  private handleFailure(error: unknown): void {
    if (error instanceof HttpErrorResponse) {
      const code = readErrorResponse(error.error)?.code;
      if (error.status === 401 && code === GET_CAPABILITIES_ERROR_CODES.invalidAccessToken) {
        this.session.end('expired');
        return;
      }
      if (error.status === 403 && code === GET_CAPABILITIES_ERROR_CODES.unsupportedActorType) {
        this.session.end('unauthorized_actor');
        return;
      }
    }
    this.state.set(viewState.fromError(error));
  }

  private scheduleRecheck(): void {
    if (this.rechecks >= PROVISIONING_MAX_RECHECKS) {
      return;
    }
    this.rechecks++;
    this.recheckTimer = setTimeout(() => void this.load(), PROVISIONING_RECHECK_MS);
  }

  private reset(): void {
    this.cancelRecheck();
    this.generation++;
    this.loadedFor = null;
    this.state.set(null);
  }

  private cancelRecheck(): void {
    if (this.recheckTimer !== null) {
      clearTimeout(this.recheckTimer);
      this.recheckTimer = null;
    }
  }
}

function toAccess(response: CapabilitiesResponseDto): SessionAccess {
  return {
    actorType: response.actor_type,
    subscriptionStatus: response.subscription_status,
    permissions: new Set(response.permissions),
    capabilities: new Set(response.capabilities),
  };
}
