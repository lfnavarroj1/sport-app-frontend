import { DatePipe, DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
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
import {
  PUBLISH_ROUTE_ERROR_CODES,
  RETIRE_ROUTE_ERROR_CODES,
} from '../../../../core/api/bff-web/routes.api';
import { AsyncState } from '../../../../shared/ui/async-state/async-state';
import { ViewState, viewState } from '../../../../shared/ui/view-state';
import { RouteForm } from '../route-form/route-form';
import { RoutesGateway } from '../routes.gateway';
import {
  OrganizerRoute,
  PublishOutcome,
  RetireOutcome,
  RouteDraft,
  RouteViolation,
  toPublishRouteRequest,
} from '../routes.model';

/** Reintentos automáticos como máximo al publicar ante fallos transitorios. */
export const MAX_PUBLISH_RETRIES = 3;

interface RoutesList {
  readonly routes: readonly OrganizerRoute[];
  readonly nextCursor: string | null;
}

/** Resultado del último retiro, por ruta. */
type RetireMessage =
  | { readonly kind: 'retired' }
  | { readonly kind: 'conflict'; readonly currentVersion: number | null }
  | { readonly kind: 'failed'; readonly error: ApiError };

/**
 * Rutas del organizador (HU026, ADR-041) en `/organizador/rutas`. Publica una
 * ruta con `Idempotency-Key` por intento (misma clave en los reintentos), muestra
 * la ruta confirmada por el backend (CA1), marca las reglas del `422` en su campo
 * (CA2), lista las rutas propias con «Cargar más» y retira una tras confirmar,
 * con la versión mostrada: un `409 version_conflict` no retira y ofrece
 * actualizar; una ruta ajena responde `404` (CA4). Sin mapa embebido ni trazado.
 */
@Component({
  selector: 'app-routes-page',
  imports: [
    AsyncState,
    DatePipe,
    DecimalPipe,
    MatButtonModule,
    MatCardModule,
    RouteForm,
    TranslatePipe,
  ],
  templateUrl: './routes-page.html',
  styleUrls: ['../../training-page.scss', './routes-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RoutesPage {
  private readonly gateway = inject(RoutesGateway);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly locale = inject(LOCALE_ID);

  protected readonly state = signal<ViewState<RoutesList>>(viewState.loading());
  protected readonly loadingMore = signal(false);
  protected readonly moreError = signal<ApiError | null>(null);

  protected readonly composing = signal(false);
  protected readonly submitting = signal(false);
  protected readonly retryAttempt = signal<number | null>(null);
  protected readonly maxRetries = MAX_PUBLISH_RETRIES;
  protected readonly publishOutcome = signal<PublishOutcome | null>(null);

  /** Ruta con la confirmación de retiro abierta, o `null`. */
  protected readonly confirming = signal<string | null>(null);
  protected readonly retiring = signal<string | null>(null);
  protected readonly retireMessages = signal<ReadonlyMap<string, RetireMessage>>(new Map());

  /** Solicitud y clave del intento de publicación en curso. */
  private pending: { readonly body: string; readonly key: string } | null = null;
  private generation = 0;
  private destroyed = false;

  protected readonly list = computed(() => {
    const state = this.state();
    return state.status === 'success' ? state.data : null;
  });

  protected readonly published = computed(() => {
    const outcome = this.publishOutcome();
    return outcome?.kind === 'published' ? outcome : null;
  });

  protected readonly violations = computed<readonly RouteViolation[] | null>(() => {
    const outcome = this.publishOutcome();
    return outcome?.kind === 'invalid' ? outcome.violations : null;
  });

  protected readonly publishFailure = computed<ApiError | null>(() => {
    const outcome = this.publishOutcome();
    return outcome?.kind === 'failed' ? outcome.error : null;
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
    void this.load();
  }

  /** Primera página de rutas propias; también es el reintento y la actualización. */
  protected async load(): Promise<void> {
    const generation = ++this.generation;
    this.state.set(viewState.loading());
    this.loadingMore.set(false);
    this.moreError.set(null);
    this.confirming.set(null);
    this.retireMessages.set(new Map());
    try {
      const page = await this.gateway.loadRoutes(null);
      if (generation === this.generation && !this.destroyed) {
        this.state.set(viewState.fromData<RoutesList>(page, (data) => data.routes.length === 0));
      }
    } catch (error) {
      if (generation === this.generation && !this.destroyed) {
        this.state.set(viewState.fromError(error));
      }
    }
  }

  /** Página siguiente con el cursor del backend, sin modificarlo. */
  protected async loadMore(): Promise<void> {
    const current = this.list();
    if (current?.nextCursor == null || this.loadingMore()) {
      return;
    }
    const generation = this.generation;
    this.loadingMore.set(true);
    this.moreError.set(null);
    try {
      const next = await this.gateway.loadRoutes(current.nextCursor);
      if (generation === this.generation) {
        this.state.set({
          status: 'success',
          data: { routes: [...current.routes, ...next.routes], nextCursor: next.nextCursor },
        });
      }
    } catch (error) {
      if (generation === this.generation) {
        this.moreError.set(toApiError(error));
      }
    } finally {
      if (generation === this.generation) {
        this.loadingMore.set(false);
      }
    }
  }

  protected compose(): void {
    this.composing.set(true);
    this.publishOutcome.set(null);
    this.pending = null;
  }

  protected cancelCompose(): void {
    this.composing.set(false);
    this.publishOutcome.set(null);
    this.pending = null;
  }

  /** El organizador cambió los datos: el siguiente envío es un intento nuevo. */
  protected onEdited(): void {
    this.pending = null;
  }

  protected async publish(draft: RouteDraft): Promise<void> {
    if (this.submitting()) {
      return;
    }
    const key = this.keyFor(draft);
    this.submitting.set(true);
    this.retryAttempt.set(null);
    this.publishOutcome.set(null);
    let outcome: PublishOutcome;
    try {
      outcome = await this.gateway.publish(draft, key, (attempt) => this.retryAttempt.set(attempt));
    } catch (error) {
      outcome = { kind: 'failed', error: toApiError(error) };
    }
    if (this.destroyed) {
      return;
    }
    this.submitting.set(false);
    this.retryAttempt.set(null);
    this.publishOutcome.set(outcome);
    if (
      outcome.kind === 'published' ||
      (outcome.kind === 'failed' &&
        outcome.error.code === PUBLISH_ROUTE_ERROR_CODES.idempotencyKeyReused)
    ) {
      this.pending = null;
    }
    if (outcome.kind === 'published') {
      this.composing.set(false);
      this.prepend(outcome.route);
      this.focus('route-published');
    } else if (outcome.kind === 'failed') {
      this.focus('route-publish-error');
    }
  }

  protected askRetire(route: OrganizerRoute): void {
    this.confirming.set(route.id);
    this.focus(`route-retire-confirm-${route.id}`);
  }

  protected cancelRetire(): void {
    this.confirming.set(null);
  }

  protected async retire(route: OrganizerRoute): Promise<void> {
    if (this.retiring() !== null) {
      return;
    }
    this.retiring.set(route.id);
    let outcome: RetireOutcome;
    try {
      outcome = await this.gateway.retire(route.id, route.version);
    } catch (error) {
      outcome = { kind: 'failed', error: toApiError(error) };
    }
    if (this.destroyed) {
      return;
    }
    this.retiring.set(null);
    this.confirming.set(null);
    if (outcome.kind === 'retired') {
      this.replace(outcome.route);
      this.setRetireMessage(route.id, { kind: 'retired' });
    } else {
      this.setRetireMessage(route.id, outcome);
    }
    this.focus(`route-retire-message-${route.id}`);
  }

  protected retireMessage(routeId: string): RetireMessage | null {
    return this.retireMessages().get(routeId) ?? null;
  }

  /** Error del último retiro de la ruta, si falló por algo distinto de un conflicto. */
  protected retireError(message: RetireMessage): ApiError | null {
    return message.kind === 'failed' ? message.error : null;
  }

  protected publishFailureMessage(error: ApiError): string {
    return error.code === PUBLISH_ROUTE_ERROR_CODES.idempotencyKeyReused
      ? 'training.routes.errors.idempotencyKeyReused'
      : `common.errors.${error.kind}`;
  }

  protected retireFailureMessage(error: ApiError): string {
    return error.code === RETIRE_ROUTE_ERROR_CODES.routeNotFound
      ? 'training.routes.errors.routeNotFound'
      : `common.errors.${error.kind}`;
  }

  /** Tras agotar los reintentos automáticos, reintentar no publica dos veces. */
  protected retryable(error: ApiError): boolean {
    return error.kind === 'offline' || error.kind === 'server';
  }

  protected coordinate(value: number): string {
    return new Intl.NumberFormat(this.locale, { maximumFractionDigits: 6 }).format(value);
  }

  protected distance(text: string): string {
    return new Intl.NumberFormat(this.locale, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(Number(text));
  }

  /**
   * Agrega al principio la ruta recién publicada (la más reciente). Un reintento
   * idempotente devuelve una ruta que ya está en la lista: no se duplica.
   */
  private prepend(route: OrganizerRoute): void {
    const current = this.list() ?? { routes: [], nextCursor: null };
    const others = current.routes.filter((item) => item.id !== route.id);
    this.state.set({ status: 'success', data: { ...current, routes: [route, ...others] } });
  }

  /** Reemplaza en la lista la ruta que confirmó el retiro. */
  private replace(route: OrganizerRoute): void {
    const current = this.list();
    if (current !== null) {
      const routes = current.routes.map((item) => (item.id === route.id ? route : item));
      this.state.set({ status: 'success', data: { ...current, routes } });
    }
  }

  private setRetireMessage(routeId: string, message: RetireMessage): void {
    const messages = new Map(this.retireMessages());
    messages.set(routeId, message);
    this.retireMessages.set(messages);
  }

  private keyFor(draft: RouteDraft): string {
    const body = JSON.stringify(toPublishRouteRequest(draft));
    if (this.pending?.body !== body) {
      this.pending = { body, key: crypto.randomUUID() };
    }
    return this.pending.key;
  }

  private focus(testId: string): void {
    afterNextRender(
      () =>
        this.host.nativeElement.querySelector<HTMLElement>(`[data-testid="${testId}"]`)?.focus(),
      { injector: this.injector },
    );
  }
}
