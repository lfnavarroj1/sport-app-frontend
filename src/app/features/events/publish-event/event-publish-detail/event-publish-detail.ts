import { DatePipe, DecimalPipe, NgTemplateOutlet } from '@angular/common';
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
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { ActivatedRoute } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { ApiError, toApiError } from '../../../../core/api/api-error';
import { PUBLISH_EVENT_ERROR_CODES } from '../../../../core/api/bff-web/events.api';
import { AsyncState } from '../../../../shared/ui/async-state/async-state';
import { ViewState, viewState } from '../../../../shared/ui/view-state';
import { countryName, formatInZone } from '../../create-event/event-time';
import { fieldKey, issueKey } from '../../create-event/event-violations';
import { PublishEventGateway } from '../publish-event.gateway';
import {
  DetailRow,
  EventDetail,
  OrganizerEvent,
  PublishOutcome,
  PublishViolation,
  rowFor,
  startsInPast,
} from '../publish-event.model';
import { PublishedEventsStore } from '../published-events.store';

const EVENT_NOT_FOUND = PUBLISH_EVENT_ERROR_CODES.eventNotFound;
const IDEMPOTENCY_KEY_REUSED = PUBLISH_EVENT_ERROR_CODES.idempotencyKeyReused;
/** Reintentos automáticos como máximo ante fallos transitorios (ADR-033). */
export const MAX_PUBLISH_RETRIES = 3;

type Step = 'review' | 'confirm';

/**
 * Detalle de un evento propio (HU024) en `/organizador/eventos/publicacion/:eventId`.
 * Muestra el evento de `GET /v1/events/{event_id}` en la zona del navegador con
 * la zona del evento visible y, si es borrador, permite publicarlo tras
 * confirmar. La misma `Idempotency-Key` se usa en los reintentos automáticos y
 * manuales del mismo intento; se renueva tras el éxito o ante
 * `idempotency_key_reused` (CA4). Un `422` deja el evento como borrador y lista
 * los requisitos faltantes junto a cada campo (CA2). La pantalla presenta solo lo
 * que confirmó el backend, sin esperar la proyección (CA1).
 */
@Component({
  selector: 'app-event-publish-detail',
  imports: [
    AsyncState,
    DatePipe,
    DecimalPipe,
    MatButtonModule,
    MatCardModule,
    NgTemplateOutlet,
    TranslatePipe,
  ],
  templateUrl: './event-publish-detail.html',
  styleUrls: ['../../create-event/events-page.scss', './event-publish-detail.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventPublishDetail {
  private readonly gateway = inject(PublishEventGateway);
  private readonly store = inject(PublishedEventsStore);
  private readonly locale = inject(LOCALE_ID);
  private readonly injector = inject(Injector);

  protected readonly state = signal<ViewState<EventDetail>>(viewState.loading());
  protected readonly step = signal<Step>('review');
  protected readonly submitting = signal(false);
  /** Reintento automático en curso (1 a 3), o `null`. */
  protected readonly retryAttempt = signal<number | null>(null);
  protected readonly maxRetries = MAX_PUBLISH_RETRIES;
  private readonly outcome = signal<PublishOutcome | null>(null);

  /** Clave del intento lógico en curso (ADR-033, decisiones 4 y 8). */
  private idempotencyKey: string | null = null;
  private eventId: string | null = null;
  private generation = 0;

  protected readonly event = computed(() => {
    const state = this.state();
    return state.status === 'success' ? state.data : null;
  });

  /** El evento publicado por el comando en esta visita, si lo hay. */
  protected readonly published = computed<OrganizerEvent | null>(() => {
    const outcome = this.outcome();
    if (outcome?.kind === 'published') {
      return outcome.event;
    }
    const event = this.event();
    return event ? this.store.find(event.id) : null;
  });

  protected readonly replayed = computed(() => {
    const outcome = this.outcome();
    return outcome?.kind === 'published' && outcome.replayed;
  });

  protected readonly violations = computed<readonly PublishViolation[]>(() => {
    const outcome = this.outcome();
    return outcome?.kind === 'invalid' ? outcome.violations : [];
  });

  protected readonly failure = computed<ApiError | null>(() => {
    const outcome = this.outcome();
    return outcome?.kind === 'failed' ? outcome.error : null;
  });

  protected readonly notFound = computed(() => {
    const state = this.state();
    return state.status === 'error' && state.error.code === EVENT_NOT_FOUND;
  });

  protected readonly canPublish = computed(
    () => this.event()?.status === 'DRAFT' && this.published() === null,
  );

  protected readonly startsInPast = computed(() => {
    const event = this.event();
    return event !== null && this.canPublish() && startsInPast(event.startsAt);
  });

  private readonly confirmHeading = viewChild<ElementRef<HTMLElement>>('confirmHeading');
  private readonly resultHeading = viewChild<ElementRef<HTMLElement>>('resultHeading');
  private readonly violationsSummary = viewChild<ElementRef<HTMLElement>>('violationsSummary');

  constructor() {
    inject(ActivatedRoute)
      .paramMap.pipe(takeUntilDestroyed(inject(DestroyRef)))
      .subscribe((params) => {
        this.eventId = params.get('eventId');
        void this.load();
      });
  }

  /** Consulta el evento de la ruta; también es el reintento. */
  protected async load(): Promise<void> {
    const eventId = this.eventId;
    if (eventId === null) {
      return;
    }
    const generation = ++this.generation;
    this.state.set(viewState.loading());
    this.step.set('review');
    this.outcome.set(null);
    this.idempotencyKey = null;
    try {
      const event = await this.gateway.loadEvent(eventId);
      if (generation === this.generation) {
        this.state.set({ status: 'success', data: event });
      }
    } catch (error) {
      if (generation === this.generation) {
        this.state.set(viewState.fromError(error));
      }
    }
  }

  protected askConfirmation(): void {
    this.step.set('confirm');
    this.focus(this.confirmHeading);
  }

  protected cancel(): void {
    this.step.set('review');
  }

  protected async publish(): Promise<void> {
    const event = this.event();
    if (event === null || this.submitting()) {
      return;
    }
    const generation = this.generation;
    this.idempotencyKey ??= crypto.randomUUID();
    this.submitting.set(true);
    this.retryAttempt.set(null);
    this.outcome.set(null);

    let outcome: PublishOutcome;
    try {
      outcome = await this.gateway.publish(event.id, this.idempotencyKey, (attempt) =>
        this.retryAttempt.set(attempt),
      );
    } catch (error) {
      outcome = { kind: 'failed', error: toApiError(error) };
    }
    if (generation !== this.generation) {
      // Se abrió otro evento mientras tanto: este resultado ya no corresponde.
      return;
    }
    this.submitting.set(false);
    this.retryAttempt.set(null);

    if (
      outcome.kind === 'published' ||
      (outcome.kind === 'failed' && outcome.error.code === IDEMPOTENCY_KEY_REUSED)
    ) {
      this.idempotencyKey = null;
    }
    this.outcome.set(outcome);
    if (outcome.kind === 'published') {
      this.store.markPublished(outcome.event);
      this.step.set('review');
      this.focus(this.resultHeading);
    } else if (outcome.kind === 'invalid') {
      this.step.set('review');
      this.focus(this.violationsSummary);
    }
  }

  /** Requisitos faltantes que corresponden a una fila del detalle. */
  protected violationsFor(row: DetailRow): readonly PublishViolation[] {
    return this.violations().filter((violation) => rowFor(violation.field) === row);
  }

  protected issueKey(violation: PublishViolation): string {
    return issueKey(violation.issue);
  }

  protected fieldKey(violation: PublishViolation): string {
    return fieldKey(violation);
  }

  protected failureMessage(error: ApiError): string {
    if (error.code === IDEMPOTENCY_KEY_REUSED) {
      return 'events.publish.errors.idempotencyKeyReused';
    }
    if (error.code === EVENT_NOT_FOUND) {
      return 'events.publish.errors.notFound';
    }
    return `common.errors.${error.kind}`;
  }

  /** Tras agotar los reintentos automáticos, reintentar no publica dos veces. */
  protected retryable(error: ApiError): boolean {
    return error.kind === 'offline' || error.kind === 'server';
  }

  protected inZone(iso: string, timeZone: string): string {
    return formatInZone(iso, timeZone, this.locale);
  }

  protected country(event: EventDetail): string {
    return countryName(event.location.countryCode, this.locale) ?? event.location.countryCode;
  }

  private focus(target: () => ElementRef<HTMLElement> | undefined): void {
    afterNextRender(() => target()?.nativeElement.focus(), { injector: this.injector });
  }
}
