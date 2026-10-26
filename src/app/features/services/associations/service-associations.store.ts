import { Injectable, computed, inject, signal } from '@angular/core';

import { ApiError, toApiError } from '../../../core/api/api-error';
import {
  ASSOCIATE_SERVICE_ERROR_CODES,
  DISSOCIATE_SERVICE_ERROR_CODES,
} from '../../../core/api/bff-web/service-associations.api';
import { ViewState, viewState } from '../../../shared/ui/view-state';
import { ServiceAssociationsGateway } from './service-associations.gateway';
import {
  AssociateOutcome,
  AssociationsFilter,
  DissociateOutcome,
  ServiceAssociation,
} from './service-associations.model';

/** Dónde pidió el deportista la acción: en el catálogo o en «Mis servicios asociados». */
export type ActionOrigin = 'catalog' | 'list';

/** Último resultado de una acción sobre un servicio, para mostrarlo donde se pidió. */
export type ServiceActionMessage =
  | { readonly kind: 'associated'; readonly origin: ActionOrigin; readonly replayed: boolean }
  | { readonly kind: 'exists'; readonly origin: ActionOrigin }
  | { readonly kind: 'dissociated'; readonly origin: ActionOrigin }
  | {
      readonly kind: 'failed';
      readonly origin: ActionOrigin;
      readonly action: 'associate' | 'dissociate';
      readonly error: ApiError;
    };

/** Aviso general de la lista (región `status`). */
export interface AssociationsNotice {
  readonly kind: 'associated' | 'dissociated' | 'exists';
  readonly name: string;
}

const CAPABILITY_REQUIRED = ASSOCIATE_SERVICE_ERROR_CODES.capabilityRequired;

/**
 * Estado de HU017 compartido por el catálogo médico de HU020 (acciones
 * «Asociar»/«Quitar») y la lista «Mis servicios asociados». Se provee en la ruta:
 * vive mientras el deportista está en la pantalla y se descarta al salir.
 *
 * Solo refleja lo que confirma el backend: la asociación creada llega en el
 * `201`, y tras quitar una se vuelve a consultar la lista para mostrar el
 * `ended_at` que registró el servicio. Una asociación existente (`409`) no se
 * duplica: se recarga la lista y se resalta la activa.
 */
@Injectable()
export class ServiceAssociationsStore {
  private readonly gateway = inject(ServiceAssociationsGateway);

  readonly filter = signal<AssociationsFilter>('ACTIVE');
  readonly state = signal<ViewState<{ readonly associations: readonly ServiceAssociation[] }>>(
    viewState.loading(),
  );
  readonly associations = signal<readonly ServiceAssociation[]>([]);
  readonly nextCursor = signal<string | null>(null);
  readonly loadingMore = signal(false);
  readonly moreError = signal<ApiError | null>(null);
  /** El plan ya no incluye `services.sports_medicine.access` (`403 capability_required`). */
  readonly capabilityMissing = signal(false);
  /** Asociación que se resalta en la lista: la recién creada o la existente de un `409`. */
  readonly highlighted = signal<string | null>(null);
  readonly notice = signal<AssociationsNotice | null>(null);
  /** Servicio cuya asociación está en curso (evita el doble envío). */
  readonly associating = signal<string | null>(null);
  /** Asociación que se está quitando. */
  readonly dissociating = signal<string | null>(null);
  /** Reintento automático en curso al asociar (1 a 3), o 0. */
  readonly retryAttempt = signal(0);
  private readonly messages = signal<ReadonlyMap<string, ServiceActionMessage>>(new Map());

  /** Asociación activa por servicio, entre las cargadas. */
  readonly activeByService = computed(
    () =>
      new Map(
        this.associations()
          .filter((association) => association.status === 'ACTIVE')
          .map((association) => [association.serviceId, association]),
      ),
  );

  /** Clave por intento lógico: se conserva para reintentar sin asociar dos veces. */
  private readonly pendingKeys = new Map<string, string>();
  /** Evita que una respuesta de una consulta anterior pise la vigente. */
  private generation = 0;
  private loaded = false;

  /** Carga la primera página una sola vez (la primera vista que la necesite). */
  ensureLoaded(): void {
    if (!this.loaded) {
      this.loaded = true;
      void this.load();
    }
  }

  /** Primera página con el filtro vigente; también es el reintento. */
  async load(): Promise<void> {
    const generation = ++this.generation;
    this.state.set(viewState.loading());
    this.nextCursor.set(null);
    this.moreError.set(null);
    this.loadingMore.set(false);
    try {
      const page = await this.gateway.loadPage(this.filter(), null);
      if (generation !== this.generation) {
        return;
      }
      this.associations.set(page.associations);
      this.nextCursor.set(page.nextCursor);
      this.state.set(
        viewState.fromData(
          { associations: page.associations },
          (data) => data.associations.length === 0,
        ),
      );
    } catch (error) {
      if (generation === this.generation) {
        this.associations.set([]);
        this.noteCapability(toApiError(error));
        // Ningún error se presenta como lista vacía.
        this.state.set(viewState.fromError(error));
      }
    }
  }

  setFilter(filter: AssociationsFilter): void {
    if (filter !== this.filter()) {
      this.filter.set(filter);
      void this.load();
    }
  }

  /** Página siguiente con el cursor tal como lo entregó el backend. */
  async loadMore(): Promise<void> {
    const cursor = this.nextCursor();
    if (cursor === null || this.loadingMore()) {
      return;
    }
    const generation = this.generation;
    this.loadingMore.set(true);
    this.moreError.set(null);
    try {
      const page = await this.gateway.loadPage(this.filter(), cursor);
      if (generation !== this.generation) {
        return;
      }
      this.associations.update((current) => [...current, ...page.associations]);
      this.nextCursor.set(page.nextCursor);
    } catch (error) {
      if (generation === this.generation) {
        // Las asociaciones ya cargadas se conservan; solo falla la página siguiente.
        this.moreError.set(toApiError(error));
      }
    } finally {
      if (generation === this.generation) {
        this.loadingMore.set(false);
      }
    }
  }

  message(serviceId: string, origin: ActionOrigin): ServiceActionMessage | null {
    const message = this.messages().get(serviceId);
    return message?.origin === origin ? message : null;
  }

  /** Asocia un servicio médico publicado tras la confirmación del deportista (CA1). */
  async associate(serviceId: string, name: string, origin: ActionOrigin): Promise<void> {
    if (this.associating() !== null || this.dissociating() !== null) {
      return;
    }
    this.associating.set(serviceId);
    this.notice.set(null);
    this.clearMessage(serviceId);
    let outcome: AssociateOutcome;
    try {
      outcome = await this.gateway.associate(serviceId, this.keyFor(serviceId), (attempt) =>
        this.retryAttempt.set(attempt),
      );
    } catch (error) {
      outcome = { kind: 'failed', error: toApiError(error) };
    }
    this.associating.set(null);
    this.retryAttempt.set(0);
    if (outcome.kind !== 'failed' || !retryable(outcome.error)) {
      // Solo un fallo transitorio conserva la clave para el reintento manual.
      this.pendingKeys.delete(serviceId);
    }
    switch (outcome.kind) {
      case 'associated':
        this.insert(outcome.association);
        this.highlighted.set(outcome.association.id);
        this.notice.set({ kind: 'associated', name });
        this.setMessage(serviceId, { kind: 'associated', origin, replayed: outcome.replayed });
        break;
      case 'exists':
        // CA3: no se duplica; se muestra la activa que informó el backend.
        this.highlighted.set(outcome.associationId);
        this.notice.set({ kind: 'exists', name });
        this.setMessage(serviceId, { kind: 'exists', origin });
        void this.load();
        break;
      case 'failed':
        this.noteCapability(outcome.error);
        this.setMessage(serviceId, {
          kind: 'failed',
          origin,
          action: 'associate',
          error: outcome.error,
        });
        break;
    }
  }

  /** Quita una asociación activa tras la confirmación del deportista (CA5). */
  async dissociate(association: ServiceAssociation, origin: ActionOrigin): Promise<void> {
    if (this.associating() !== null || this.dissociating() !== null) {
      return;
    }
    this.dissociating.set(association.id);
    this.notice.set(null);
    this.clearMessage(association.serviceId);
    let outcome: DissociateOutcome;
    try {
      outcome = await this.gateway.dissociate(association.id);
    } catch (error) {
      outcome = { kind: 'failed', error: toApiError(error) };
    }
    this.dissociating.set(null);
    if (outcome.kind === 'dissociated') {
      this.highlighted.set(null);
      this.notice.set({ kind: 'dissociated', name: association.name });
      this.setMessage(association.serviceId, { kind: 'dissociated', origin });
      // El historial (`ended_at`) lo confirma la consulta, no el cliente.
      void this.load();
      return;
    }
    this.noteCapability(outcome.error);
    this.setMessage(association.serviceId, {
      kind: 'failed',
      origin,
      action: 'dissociate',
      error: outcome.error,
    });
    if (outcome.error.code === DISSOCIATE_SERVICE_ERROR_CODES.associationNotFound) {
      // Ya no existe para este deportista: la lista vigente lo aclara.
      void this.load();
    }
  }

  /** Agrega al principio la asociación confirmada; un reintento idempotente no la duplica. */
  private insert(association: ServiceAssociation): void {
    const others = this.associations().filter((item) => item.id !== association.id);
    const associations = [association, ...others];
    this.associations.set(associations);
    if (this.state().status !== 'loading') {
      this.state.set(viewState.fromData({ associations }));
    }
  }

  private noteCapability(error: ApiError): void {
    if (error.code === CAPABILITY_REQUIRED) {
      this.capabilityMissing.set(true);
    }
  }

  private keyFor(serviceId: string): string {
    let key = this.pendingKeys.get(serviceId);
    if (key === undefined) {
      key = crypto.randomUUID();
      this.pendingKeys.set(serviceId, key);
    }
    return key;
  }

  private setMessage(serviceId: string, message: ServiceActionMessage): void {
    const messages = new Map(this.messages());
    messages.set(serviceId, message);
    this.messages.set(messages);
  }

  private clearMessage(serviceId: string): void {
    if (this.messages().has(serviceId)) {
      const messages = new Map(this.messages());
      messages.delete(serviceId);
      this.messages.set(messages);
    }
  }
}

/** Tras agotar los reintentos automáticos, reintentar con la misma clave no asocia dos veces. */
export function retryable(error: ApiError): boolean {
  return error.kind === 'offline' || error.kind === 'server';
}
