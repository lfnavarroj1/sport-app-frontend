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
import { PUBLISH_SERVICE_ERROR_CODES } from '../../../../core/api/bff-web/services.api';
import { AsyncState } from '../../../../shared/ui/async-state/async-state';
import { ViewState, viewState } from '../../../../shared/ui/view-state';
import { formatInZone } from '../../../events/create-event/event-time';
import { formatPrice } from '../../availability/availability-format';
import { issueKey } from '../../create-service/service-violations';
import { PublishServiceGateway } from '../publish-service.gateway';
import {
  DetailRow,
  OwnService,
  PublishOutcome,
  PublishViolation,
  PublishedService,
  futureIntervals,
  rowFor,
} from '../publish-service.model';
import { ServicePublicationsStore } from '../service-publications.store';

const SERVICE_NOT_FOUND = PUBLISH_SERVICE_ERROR_CODES.serviceNotFound;
const IDEMPOTENCY_KEY_REUSED = PUBLISH_SERVICE_ERROR_CODES.idempotencyKeyReused;
/** Reintentos automáticos como máximo ante fallos transitorios (ADR-027, publicación). */
export const MAX_PUBLISH_RETRIES = 3;

type Step = 'review' | 'confirm';

/** Texto de cada fila del detalle en el resumen de requisitos faltantes. */
const ROW_LABELS: Readonly<Record<DetailRow, string>> = {
  name: 'services.create.fields.name',
  description: 'services.create.fields.description',
  category: 'services.create.fields.category',
  modality: 'services.create.fields.modality',
  price: 'services.publish.requirements.price',
  billingUnit: 'services.create.fields.billingUnit',
  availability: 'services.publish.requirements.availability',
};

/**
 * Detalle de un servicio propio (HU019) en
 * `/profesional/servicios/publicacion/:serviceId`. Muestra el servicio de
 * `GET /v1/me/services/{service_id}` con la tarifa en COP, la unidad de cobro y
 * la disponibilidad futura como requisitos separados y, si es borrador, permite
 * publicarlo tras confirmar. La misma `Idempotency-Key` se usa en los reintentos
 * automáticos y manuales del mismo intento; se renueva tras el éxito o ante
 * `idempotency_key_reused` (CA4). Un `422` deja el servicio como borrador y lista
 * los requisitos faltantes junto a cada fila (CA2). Un servicio ajeno responde
 * `404` sin datos (CA3). La pantalla presenta solo lo que confirmó el backend.
 */
@Component({
  selector: 'app-service-publish-detail',
  imports: [
    AsyncState,
    DatePipe,
    DecimalPipe,
    MatButtonModule,
    MatCardModule,
    NgTemplateOutlet,
    TranslatePipe,
  ],
  templateUrl: './service-publish-detail.html',
  styleUrls: ['../../create-service/services-page.scss', './service-publish-detail.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ServicePublishDetail {
  private readonly gateway = inject(PublishServiceGateway);
  private readonly store = inject(ServicePublicationsStore);
  private readonly locale = inject(LOCALE_ID);
  private readonly injector = inject(Injector);

  protected readonly state = signal<ViewState<OwnService>>(viewState.loading());
  protected readonly step = signal<Step>('review');
  protected readonly submitting = signal(false);
  /** Reintento automático en curso (1 a 3), o `null`. */
  protected readonly retryAttempt = signal<number | null>(null);
  protected readonly maxRetries = MAX_PUBLISH_RETRIES;
  private readonly outcome = signal<PublishOutcome | null>(null);

  /** Clave del intento lógico en curso (ADR-027, publicación, decisiones 2 y 8). */
  private idempotencyKey: string | null = null;
  private serviceId: string | null = null;
  private generation = 0;

  protected readonly service = computed(() => {
    const state = this.state();
    return state.status === 'success' ? state.data : null;
  });

  /** La publicación confirmada por el comando en esta visita, si la hay. */
  protected readonly published = computed<PublishedService | null>(() => {
    const outcome = this.outcome();
    if (outcome?.kind === 'published') {
      return outcome.service;
    }
    const service = this.service();
    return service ? this.store.find(service.id) : null;
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
    return state.status === 'error' && state.error.code === SERVICE_NOT_FOUND;
  });

  protected readonly canPublish = computed(
    () => this.service()?.status === 'DRAFT' && this.published() === null,
  );

  /** Horarios que todavía no empiezan; solo para mostrar y advertir. */
  protected readonly upcoming = computed(() => {
    const service = this.service();
    return service ? futureIntervals(service.intervals) : [];
  });

  private readonly confirmHeading = viewChild<ElementRef<HTMLElement>>('confirmHeading');
  private readonly resultHeading = viewChild<ElementRef<HTMLElement>>('resultHeading');
  private readonly violationsSummary = viewChild<ElementRef<HTMLElement>>('violationsSummary');

  constructor() {
    inject(ActivatedRoute)
      .paramMap.pipe(takeUntilDestroyed(inject(DestroyRef)))
      .subscribe((params) => {
        this.serviceId = params.get('serviceId');
        void this.load();
      });
  }

  /** Consulta el servicio de la ruta; también es el reintento. */
  protected async load(): Promise<void> {
    const serviceId = this.serviceId;
    if (serviceId === null) {
      return;
    }
    const generation = ++this.generation;
    this.state.set(viewState.loading());
    this.step.set('review');
    this.outcome.set(null);
    this.idempotencyKey = null;
    try {
      const service = await this.gateway.loadService(serviceId);
      if (generation === this.generation) {
        this.state.set({ status: 'success', data: service });
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
    const service = this.service();
    if (service === null || this.submitting()) {
      return;
    }
    const generation = this.generation;
    this.idempotencyKey ??= crypto.randomUUID();
    this.submitting.set(true);
    this.retryAttempt.set(null);
    this.outcome.set(null);

    let outcome: PublishOutcome;
    try {
      outcome = await this.gateway.publish(service.id, this.idempotencyKey, (attempt) =>
        this.retryAttempt.set(attempt),
      );
    } catch (error) {
      outcome = { kind: 'failed', error: toApiError(error) };
    }
    if (generation !== this.generation) {
      // Se abrió otro servicio mientras tanto: este resultado ya no corresponde.
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
      this.store.markPublished(outcome.service);
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

  /** Motivo del requisito; la falta de horarios futuros tiene su propia explicación. */
  protected issueKey(violation: PublishViolation): string {
    return violation.field === 'availability' && violation.issue === 'required'
      ? 'services.publish.violations.availabilityRequired'
      : issueKey(violation.issue);
  }

  protected fieldKey(violation: PublishViolation): string {
    const row = rowFor(violation.field);
    return row ? ROW_LABELS[row] : 'services.create.issues.fieldRequest';
  }

  protected failureMessage(error: ApiError): string {
    if (error.code === IDEMPOTENCY_KEY_REUSED) {
      return 'services.publish.errors.idempotencyKeyReused';
    }
    if (error.code === SERVICE_NOT_FOUND) {
      return 'services.publish.errors.notFound';
    }
    return `common.errors.${error.kind}`;
  }

  /** Tras agotar los reintentos automáticos, reintentar no publica dos veces. */
  protected retryable(error: ApiError): boolean {
    return error.kind === 'offline' || error.kind === 'server';
  }

  /** Tarifa informativa en `es-CO`; el dato sigue siendo la cadena del backend. */
  protected price(service: OwnService): string {
    return formatPrice(service.price.amount);
  }

  /** Instante del horario en la zona que declaró el profesional. */
  protected inZone(iso: string, timeZone: string): string {
    return formatInZone(iso, timeZone, this.locale);
  }

  private focus(target: () => ElementRef<HTMLElement> | undefined): void {
    afterNextRender(() => target()?.nativeElement.focus(), { injector: this.injector });
  }
}
