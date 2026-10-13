import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  LOCALE_ID,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { TranslatePipe } from '@ngx-translate/core';

import { ApiError, toApiError } from '../../../../core/api/api-error';
import { CREATE_EVENT_ERROR_CODES } from '../../../../core/api/bff-web/events.api';
import { CreateEventForm } from '../create-event-form/create-event-form';
import { CreateEventGateway } from '../create-event.gateway';
import { CreateEventOutcome, CreatedEvent, EventDraft } from '../create-event.model';
import { countryName, formatInZone } from '../event-time';

const IDEMPOTENCY_KEY_REUSED = CREATE_EVENT_ERROR_CODES.idempotencyKeyReused;
/** Reintentos automáticos como máximo ante fallos transitorios (ADR-028). */
export const MAX_AUTOMATIC_RETRIES = 3;

/**
 * Crear evento (HU021) en `/organizador/eventos/nuevo`. Envía exactamente los
 * campos de ADR-028 y presenta el borrador que devuelve `201`, sin consultar la
 * proyección (CA1, CA5). Los rechazos por actor o permiso (CA2) y las reglas
 * incumplidas (CA3) se informan sin crear nada. La misma `Idempotency-Key` se
 * usa en los reintentos automáticos y manuales del mismo intento, de modo que
 * una respuesta perdida no duplica el evento (CA4, CA7).
 */
@Component({
  selector: 'app-create-event-page',
  imports: [CreateEventForm, DecimalPipe, MatButtonModule, MatCardModule, TranslatePipe],
  templateUrl: './create-event-page.html',
  styleUrl: '../events-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreateEventPage {
  private readonly gateway = inject(CreateEventGateway);
  private readonly locale = inject(LOCALE_ID);

  /**
   * Clave del intento lógico en curso: se conserva en los reintentos y se
   * descarta al cambiar los datos, al confirmarse el borrador o cuando el BFF la
   * rechaza por reutilizada.
   */
  private idempotencyKey: string | null = null;

  protected readonly submitting = signal(false);
  /** Reintento automático en curso (1 a 3), o `null`. */
  protected readonly retryAttempt = signal<number | null>(null);
  protected readonly maxRetries = MAX_AUTOMATIC_RETRIES;
  private readonly outcome = signal<CreateEventOutcome | null>(null);

  protected readonly created = computed(() => {
    const outcome = this.outcome();
    return outcome?.kind === 'created' ? outcome : null;
  });

  protected readonly failure = computed<ApiError | null>(() => {
    const outcome = this.outcome();
    return outcome?.kind === 'failed' ? outcome.error : null;
  });

  protected readonly violations = computed(() => {
    const outcome = this.outcome();
    return outcome?.kind === 'invalid' ? outcome.violations : null;
  });

  private readonly heading = viewChild<ElementRef<HTMLElement>>('createdHeading');

  constructor() {
    effect(() => this.heading()?.nativeElement.focus());
  }

  protected async create(draft: EventDraft): Promise<void> {
    if (this.submitting()) {
      return;
    }
    this.idempotencyKey ??= crypto.randomUUID();
    this.submitting.set(true);
    this.retryAttempt.set(null);
    this.outcome.set(null);

    let outcome: CreateEventOutcome;
    try {
      outcome = await this.gateway.createEvent(draft, this.idempotencyKey, (attempt) =>
        this.retryAttempt.set(attempt),
      );
    } catch (error) {
      outcome = { kind: 'failed', error: toApiError(error) };
    }
    this.submitting.set(false);
    this.retryAttempt.set(null);

    if (
      outcome.kind === 'created' ||
      (outcome.kind === 'failed' && outcome.error.code === IDEMPOTENCY_KEY_REUSED)
    ) {
      this.idempotencyKey = null;
    }
    this.outcome.set(outcome);
  }

  protected onEdited(): void {
    this.idempotencyKey = null;
  }

  protected createAnother(): void {
    this.idempotencyKey = null;
    // El formulario vuelve a montarse vacío al salir del resultado.
    this.outcome.set(null);
  }

  protected failureMessage(error: ApiError): string {
    return error.code === IDEMPOTENCY_KEY_REUSED
      ? 'events.create.errors.idempotencyKeyReused'
      : `common.errors.${error.kind}`;
  }

  /** Tras agotar los reintentos automáticos, reintentar no duplica el evento. */
  protected retryable(error: ApiError): boolean {
    return error.kind === 'offline' || error.kind === 'server';
  }

  protected inZone(iso: string, event: CreatedEvent): string {
    return formatInZone(iso, event.timeZone, this.locale);
  }

  protected country(event: CreatedEvent): string {
    return countryName(event.location.countryCode, this.locale) ?? event.location.countryCode;
  }
}
