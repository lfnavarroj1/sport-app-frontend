import { DatePipe, DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
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
  PUBLISH_TEMPLATE_ERROR_CODES,
  RETIRE_TEMPLATE_ERROR_CODES,
} from '../../../../core/api/bff-web/training-templates.api';
import { AsyncState } from '../../../../shared/ui/async-state/async-state';
import { ViewState, viewState } from '../../../../shared/ui/view-state';
import { TemplateForm } from '../template-form/template-form';
import { TemplatesGateway } from '../templates.gateway';
import {
  PublishOutcome,
  RetireOutcome,
  TemplateDraft,
  TemplateViolation,
  TrainingTemplate,
  toPublishTemplateRequest,
  weeklyMinutes,
} from '../templates.model';

/** Reintentos automáticos como máximo al publicar ante fallos transitorios. */
export const MAX_PUBLISH_RETRIES = 3;

interface TemplatesList {
  readonly templates: readonly TrainingTemplate[];
  readonly nextCursor: string | null;
}

/** Resultado del último retiro, por plantilla. */
type RetireMessage =
  | { readonly kind: 'retired' }
  | { readonly kind: 'conflict'; readonly currentVersion: number | null }
  | { readonly kind: 'failed'; readonly error: ApiError };

/**
 * Plantillas de plan de entrenamiento del profesional (HU028, ADR-041) en
 * `/profesional/entrenamientos/plantillas`. Publica una plantilla con
 * `Idempotency-Key` por intento (misma clave en los reintentos), muestra la
 * plantilla confirmada por el backend, marca las reglas del `422` en su campo o
 * sesión (CA4), lista las plantillas propias con «Cargar más» y retira una tras
 * confirmar, con la versión mostrada: un `409 version_conflict` no retira y
 * ofrece actualizar; una plantilla ajena responde `404` (CA3). Publicar no asigna
 * el plan a nadie: la asignación es HU010.
 */
@Component({
  selector: 'app-templates-page',
  imports: [
    AsyncState,
    DatePipe,
    DecimalPipe,
    MatButtonModule,
    MatCardModule,
    TemplateForm,
    TranslatePipe,
  ],
  templateUrl: './templates-page.html',
  styleUrls: ['../../training-page.scss', './templates-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TemplatesPage {
  private readonly gateway = inject(TemplatesGateway);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly state = signal<ViewState<TemplatesList>>(viewState.loading());
  protected readonly loadingMore = signal(false);
  protected readonly moreError = signal<ApiError | null>(null);

  protected readonly composing = signal(false);
  protected readonly submitting = signal(false);
  protected readonly retryAttempt = signal<number | null>(null);
  protected readonly maxRetries = MAX_PUBLISH_RETRIES;
  protected readonly publishOutcome = signal<PublishOutcome | null>(null);

  /** Plantilla con la confirmación de retiro abierta, o `null`. */
  protected readonly confirming = signal<string | null>(null);
  protected readonly retiring = signal<string | null>(null);
  protected readonly retireMessages = signal<ReadonlyMap<string, RetireMessage>>(new Map());

  protected readonly weeklyMinutes = weeklyMinutes;

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

  protected readonly violations = computed<readonly TemplateViolation[] | null>(() => {
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

  /** Primera página de plantillas propias; también es el reintento y la actualización. */
  protected async load(): Promise<void> {
    const generation = ++this.generation;
    this.state.set(viewState.loading());
    this.loadingMore.set(false);
    this.moreError.set(null);
    this.confirming.set(null);
    this.retireMessages.set(new Map());
    try {
      const page = await this.gateway.loadTemplates(null);
      if (generation === this.generation && !this.destroyed) {
        this.state.set(
          viewState.fromData<TemplatesList>(page, (data) => data.templates.length === 0),
        );
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
      const next = await this.gateway.loadTemplates(current.nextCursor);
      if (generation === this.generation) {
        this.state.set({
          status: 'success',
          data: {
            templates: [...current.templates, ...next.templates],
            nextCursor: next.nextCursor,
          },
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

  /** El profesional cambió los datos: el siguiente envío es un intento nuevo. */
  protected onEdited(): void {
    this.pending = null;
  }

  protected async publish(draft: TemplateDraft): Promise<void> {
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
        outcome.error.code === PUBLISH_TEMPLATE_ERROR_CODES.idempotencyKeyReused)
    ) {
      this.pending = null;
    }
    if (outcome.kind === 'published') {
      this.composing.set(false);
      this.prepend(outcome.template);
      this.focus('template-published');
    } else if (outcome.kind === 'failed') {
      this.focus('template-publish-error');
    }
  }

  protected askRetire(template: TrainingTemplate): void {
    this.confirming.set(template.id);
    this.focus(`template-retire-confirm-${template.id}`);
  }

  protected cancelRetire(): void {
    this.confirming.set(null);
  }

  protected async retire(template: TrainingTemplate): Promise<void> {
    if (this.retiring() !== null) {
      return;
    }
    this.retiring.set(template.id);
    let outcome: RetireOutcome;
    try {
      outcome = await this.gateway.retire(template.id, template.version);
    } catch (error) {
      outcome = { kind: 'failed', error: toApiError(error) };
    }
    if (this.destroyed) {
      return;
    }
    this.retiring.set(null);
    this.confirming.set(null);
    if (outcome.kind === 'retired') {
      this.replace(outcome.template);
      this.setRetireMessage(template.id, { kind: 'retired' });
    } else {
      this.setRetireMessage(template.id, outcome);
    }
    this.focus(`template-retire-message-${template.id}`);
  }

  protected retireMessage(templateId: string): RetireMessage | null {
    return this.retireMessages().get(templateId) ?? null;
  }

  /** Error del último retiro de la plantilla, si falló por algo distinto de un conflicto. */
  protected retireError(message: RetireMessage): ApiError | null {
    return message.kind === 'failed' ? message.error : null;
  }

  protected publishFailureMessage(error: ApiError): string {
    return error.code === PUBLISH_TEMPLATE_ERROR_CODES.idempotencyKeyReused
      ? 'training.templates.errors.idempotencyKeyReused'
      : `common.errors.${error.kind}`;
  }

  protected retireFailureMessage(error: ApiError): string {
    return error.code === RETIRE_TEMPLATE_ERROR_CODES.templateNotFound
      ? 'training.templates.errors.templateNotFound'
      : `common.errors.${error.kind}`;
  }

  /** Tras agotar los reintentos automáticos, reintentar no publica dos veces. */
  protected retryable(error: ApiError): boolean {
    return error.kind === 'offline' || error.kind === 'server';
  }

  /**
   * Agrega al principio la plantilla recién publicada (la más reciente). Un
   * reintento idempotente devuelve una plantilla que ya está en la lista: no se duplica.
   */
  private prepend(template: TrainingTemplate): void {
    const current = this.list() ?? { templates: [], nextCursor: null };
    const others = current.templates.filter((item) => item.id !== template.id);
    this.state.set({
      status: 'success',
      data: { ...current, templates: [template, ...others] },
    });
  }

  /** Reemplaza en la lista la plantilla que confirmó el retiro. */
  private replace(template: TrainingTemplate): void {
    const current = this.list();
    if (current !== null) {
      const templates = current.templates.map((item) =>
        item.id === template.id ? template : item,
      );
      this.state.set({ status: 'success', data: { ...current, templates } });
    }
  }

  private setRetireMessage(templateId: string, message: RetireMessage): void {
    const messages = new Map(this.retireMessages());
    messages.set(templateId, message);
    this.retireMessages.set(messages);
  }

  private keyFor(draft: TemplateDraft): string {
    const body = JSON.stringify(toPublishTemplateRequest(draft));
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
