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
import { CREATE_SERVICE_ERROR_CODES } from '../../../../core/api/bff-web/services.api';
import { formatInZone } from '../../../events/create-event/event-time';
import { formatPrice } from '../../availability/availability-format';
import { CreateServiceForm } from '../create-service-form/create-service-form';
import { CreateServiceGateway } from '../create-service.gateway';
import { CreateServiceOutcome, CreatedService, ServiceDraft } from '../create-service.model';

const IDEMPOTENCY_KEY_REUSED = CREATE_SERVICE_ERROR_CODES.idempotencyKeyReused;
/** Reintentos automáticos como máximo ante fallos transitorios. */
export const MAX_AUTOMATIC_RETRIES = 3;

/**
 * Crear servicio (HU015) en `/profesional/servicios/nuevo`. Envía exactamente
 * los campos de ADR-027 y presenta el borrador que devuelve `201` (CA1, CA5).
 * Los rechazos por permiso (CA2) y las reglas incumplidas (CA3, CA6) se informan
 * sin crear nada. La misma `Idempotency-Key` se usa en los reintentos
 * automáticos y manuales del mismo intento, de modo que una respuesta perdida
 * no duplica el servicio (CA4). La tarifa es de referencia: nada de esta
 * pantalla cobra, factura ni contrata (CA7).
 */
@Component({
  selector: 'app-create-service-page',
  imports: [CreateServiceForm, DecimalPipe, MatButtonModule, MatCardModule, TranslatePipe],
  templateUrl: './create-service-page.html',
  styleUrl: '../services-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreateServicePage {
  private readonly gateway = inject(CreateServiceGateway);
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
  private readonly outcome = signal<CreateServiceOutcome | null>(null);

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

  protected async create(draft: ServiceDraft): Promise<void> {
    if (this.submitting()) {
      return;
    }
    this.idempotencyKey ??= crypto.randomUUID();
    this.submitting.set(true);
    this.retryAttempt.set(null);
    this.outcome.set(null);

    let outcome: CreateServiceOutcome;
    try {
      outcome = await this.gateway.createService(draft, this.idempotencyKey, (attempt) =>
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
      ? 'services.create.errors.idempotencyKeyReused'
      : `common.errors.${error.kind}`;
  }

  /** Tras agotar los reintentos automáticos, reintentar no duplica el servicio. */
  protected retryable(error: ApiError): boolean {
    return error.kind === 'offline' || error.kind === 'server';
  }

  /** Importe en `es-CO`, solo para mostrarlo; el dato sigue siendo la cadena del backend. */
  protected price(service: CreatedService): string {
    return formatPrice(service.price.amount);
  }

  /** Instante del intervalo en la zona que declaró el profesional. */
  protected inZone(iso: string, timeZone: string): string {
    return formatInZone(iso, timeZone, this.locale);
  }
}
