import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  LOCALE_ID,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ActivatedRoute } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { map } from 'rxjs';

import { ApiError, toApiError } from '../../../../core/api/api-error';
import { EVENT_FEE_ERROR_CODES, EVENT_FEE_ISSUES } from '../../../../core/api/bff-web/events.api';
import { formatInZone } from '../../create-event/event-time';
import { EventPricingGateway } from '../event-pricing.gateway';
import {
  FeeOutcome,
  FeeViolation,
  PricedEvent,
  amountInputValue,
  formatCop,
  hasStarted,
  isFree,
  parseCopAmount,
} from '../event-pricing.model';
import { EventPricingStore } from '../event-pricing.store';

const EVENT_NOT_FOUND = EVENT_FEE_ERROR_CODES.eventNotFound;
const IDEMPOTENCY_KEY_REUSED = EVENT_FEE_ERROR_CODES.idempotencyKeyReused;
/** Reintentos automáticos como máximo ante fallos transitorios. */
export const MAX_FEE_RETRIES = 3;

type Operation = 'set' | 'remove';
type Step = 'edit' | 'confirm';

/** Intento lógico en curso: la clave se conserva mientras la operación y el importe no cambien. */
interface Attempt {
  readonly operation: Operation;
  readonly amount: string | null;
  readonly key: string;
}

/** Validación de experiencia del importe: formato `es-CO` y límites del contrato. */
function amountValidator(control: AbstractControl<string>): ValidationErrors | null {
  const parsed = parseCopAmount(control.value ?? '');
  return parsed.ok ? null : { [parsed.error]: true };
}

/**
 * Tarifa de un evento propio (HU025) en `/organizador/eventos/tarifas/:eventId`.
 * Asigna un valor en pesos colombianos (`0` = gratuito) o retira la tarifa,
 * siempre tras confirmar y con la versión vista (`expected_version`). Advierte
 * cuando hay inscritos, que conservan su tarifa (CA4). Usa una `Idempotency-Key`
 * por intento, conservada en los reintentos ante red o `5xx` (CA5). Un `422`
 * se marca junto al campo (CA2), un `409 version_conflict` ofrece actualizar el
 * evento (CA3) y el resultado es el del comando, sin esperar la proyección (CA1).
 * La tarifa es informativa: no confirma cobros ni pagos.
 */
@Component({
  selector: 'app-event-fee-editor',
  imports: [
    DatePipe,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule,
    TranslatePipe,
  ],
  templateUrl: './event-fee-editor.html',
  styleUrls: ['../../create-event/events-page.scss', './event-fee-editor.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventFeeEditor {
  private readonly gateway = inject(EventPricingGateway);
  private readonly store = inject(EventPricingStore);
  private readonly locale = inject(LOCALE_ID);
  private readonly injector = inject(Injector);

  protected readonly amount = new FormControl('', {
    nonNullable: true,
    validators: [amountValidator],
  });
  protected readonly form = new FormGroup({ amount: this.amount });
  protected readonly maxRetries = MAX_FEE_RETRIES;

  private readonly eventId = toSignal(
    inject(ActivatedRoute).paramMap.pipe(map((params) => params.get('eventId'))),
    { initialValue: null },
  );
  private readonly amountValue = toSignal(this.amount.valueChanges, { initialValue: '' });

  protected readonly listState = this.store.view;
  protected readonly event = computed(() => this.store.find(this.eventId()));
  protected readonly step = signal<Step>('edit');
  protected readonly operation = signal<Operation>('set');
  protected readonly submitting = signal(false);
  /** Reintento automático en curso (1 a 3), o `null`. */
  protected readonly retryAttempt = signal<number | null>(null);
  private readonly outcome = signal<{ operation: Operation; result: FeeOutcome } | null>(null);
  /** Importe ya convertido al contrato que se va a confirmar. */
  protected readonly pendingAmount = signal<string | null>(null);

  private attempt: Attempt | null = null;
  private openedId: string | null = null;
  private generation = 0;

  /** Lista cargada sin el evento de la ruta: inexistente o de otro organizador. */
  protected readonly missing = computed(
    () => this.listState().status !== 'loading' && this.event() === null,
  );

  protected readonly preview = computed(() => {
    const parsed = parseCopAmount(this.amountValue());
    return parsed.ok ? parsed.amount : null;
  });

  protected readonly updated = computed(() => {
    const outcome = this.outcome();
    return outcome?.result.kind === 'updated'
      ? { ...outcome.result, removed: outcome.operation === 'remove' }
      : null;
  });

  protected readonly violations = computed<readonly FeeViolation[]>(() => {
    const result = this.outcome()?.result;
    return result?.kind === 'invalid' ? result.violations : [];
  });

  /** Reglas incumplidas que no corresponden al campo del importe. */
  protected readonly otherViolations = computed(() =>
    this.violations().filter((violation) => violation.field !== 'amount'),
  );

  protected readonly conflict = computed(() => {
    const result = this.outcome()?.result;
    return result?.kind === 'conflict' ? result : null;
  });

  protected readonly failure = computed<ApiError | null>(() => {
    const result = this.outcome()?.result;
    return result?.kind === 'failed' ? result.error : null;
  });

  protected readonly started = computed(() => {
    const event = this.event();
    return event !== null && hasStarted(event.startsAt);
  });

  private readonly amountInput = viewChild<ElementRef<HTMLInputElement>>('amountInput');
  private readonly confirmHeading = viewChild<ElementRef<HTMLElement>>('confirmHeading');
  private readonly resultHeading = viewChild<ElementRef<HTMLElement>>('resultHeading');
  private readonly problemSummary = viewChild<ElementRef<HTMLElement>>('problemSummary');

  constructor() {
    // Al abrir otro evento (o al cargarse la lista) el formulario parte de su tarifa vigente.
    effect(() => {
      const event = this.event();
      untracked(() => {
        if (event !== null && event.id !== this.openedId) {
          this.openedId = event.id;
          this.reset(event);
        }
      });
    });
  }

  protected askSet(): void {
    this.amount.markAsTouched();
    const parsed = parseCopAmount(this.amount.value);
    if (!parsed.ok) {
      this.focus(this.amountInput);
      return;
    }
    this.ask('set', parsed.amount);
  }

  protected askRemove(): void {
    this.ask('remove', null);
  }

  protected cancel(): void {
    this.step.set('edit');
  }

  protected async confirm(): Promise<void> {
    const event = this.event();
    if (event === null || this.submitting()) {
      return;
    }
    const operation = this.operation();
    const amount = this.pendingAmount();
    if (
      this.attempt === null ||
      this.attempt.operation !== operation ||
      this.attempt.amount !== amount
    ) {
      this.attempt = { operation, amount, key: crypto.randomUUID() };
    }
    const key = this.attempt.key;
    const generation = this.generation;
    this.submitting.set(true);
    this.retryAttempt.set(null);
    this.outcome.set(null);

    const onRetry = (attempt: number) => this.retryAttempt.set(attempt);
    let result: FeeOutcome;
    try {
      result =
        operation === 'set' && amount !== null
          ? await this.gateway.setFee(event.id, amount, event.version, key, onRetry)
          : await this.gateway.removeFee(event.id, event.version, key, onRetry);
    } catch (error) {
      result = { kind: 'failed', error: toApiError(error) };
    }
    if (generation !== this.generation) {
      // Se abrió otro evento mientras tanto: este resultado ya no corresponde.
      return;
    }
    this.submitting.set(false);
    this.retryAttempt.set(null);
    this.outcome.set({ operation, result });
    this.handle(result);
  }

  /** Vuelve a consultar los eventos para tomar la versión y la tarifa vigentes (CA3). */
  protected async refresh(): Promise<void> {
    this.generation++;
    this.openedId = null;
    this.outcome.set(null);
    await this.store.load();
  }

  protected feeLabel(fee: PricedEvent['fee']): { key: string; amount: string | null } {
    if (fee === null) {
      return { key: 'events.pricing.fee.none', amount: null };
    }
    return isFree(fee)
      ? { key: 'events.pricing.fee.free', amount: null }
      : { key: 'events.pricing.fee.amount', amount: formatCop(fee.amount) };
  }

  protected previewLabel(amount: string): { key: string; amount: string | null } {
    return this.isFreeAmount(amount)
      ? { key: 'events.pricing.form.previewFree', amount: null }
      : { key: 'events.pricing.form.preview', amount: formatCop(amount) };
  }

  protected isFreeAmount(amount: string): boolean {
    return Number(amount) === 0;
  }

  protected cop(amount: string): string {
    return formatCop(amount);
  }

  protected issueKey(issue: string): string {
    return `events.pricing.issues.${(EVENT_FEE_ISSUES as readonly string[]).includes(issue) ? issue : 'unknown'}`;
  }

  protected fieldKey(field: string): string {
    return ['currency', 'starts_at', 'expected_version'].includes(field)
      ? `events.pricing.fields.${field}`
      : 'events.pricing.fields.other';
  }

  protected failureMessage(error: ApiError): string {
    if (error.code === IDEMPOTENCY_KEY_REUSED) {
      return 'events.pricing.errors.idempotencyKeyReused';
    }
    if (error.code === EVENT_NOT_FOUND) {
      return 'events.pricing.errors.notFound';
    }
    return `common.errors.${error.kind}`;
  }

  /** Tras agotar los reintentos automáticos, reintentar no aplica el cambio dos veces. */
  protected retryable(error: ApiError): boolean {
    return error.kind === 'offline' || error.kind === 'server';
  }

  protected inZone(event: PricedEvent): string {
    return formatInZone(event.startsAt, event.timeZone, this.locale);
  }

  private ask(operation: Operation, amount: string | null): void {
    this.operation.set(operation);
    this.pendingAmount.set(amount);
    this.outcome.set(null);
    this.step.set('confirm');
    this.focus(this.confirmHeading);
  }

  private handle(result: FeeOutcome): void {
    if (
      result.kind !== 'failed' ||
      result.error.code === IDEMPOTENCY_KEY_REUSED ||
      !this.retryable(result.error)
    ) {
      // Solo un fallo transitorio conserva la clave para el reintento manual.
      this.attempt = null;
    }
    if (result.kind === 'updated') {
      this.store.replace(result.event);
      this.amount.reset(result.event.fee ? amountInputValue(result.event.fee.amount) : '');
      this.step.set('edit');
      this.focus(this.resultHeading);
      return;
    }
    if (result.kind === 'invalid') {
      const amountIssue = result.violations.find((violation) => violation.field === 'amount');
      if (amountIssue) {
        this.amount.setErrors({ feeRule: amountIssue.issue });
        this.amount.markAsTouched();
      }
      this.step.set('edit');
      this.focus(this.otherViolations().length > 0 ? this.problemSummary : this.amountInput);
      return;
    }
    if (result.kind === 'conflict') {
      this.step.set('edit');
      this.focus(this.problemSummary);
    }
  }

  private reset(event: PricedEvent): void {
    this.generation++;
    this.attempt = null;
    this.outcome.set(null);
    this.pendingAmount.set(null);
    this.step.set('edit');
    this.submitting.set(false);
    this.retryAttempt.set(null);
    this.amount.reset(event.fee ? amountInputValue(event.fee.amount) : '');
  }

  private focus(target: () => ElementRef<HTMLElement> | undefined): void {
    afterNextRender(() => target()?.nativeElement.focus(), { injector: this.injector });
  }
}
