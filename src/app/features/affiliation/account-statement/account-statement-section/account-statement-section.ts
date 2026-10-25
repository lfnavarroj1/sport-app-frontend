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
import { MatButtonModule } from '@angular/material/button';
import { ActivatedRoute } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { ApiError, toApiError } from '../../../../core/api/api-error';
import { AsyncState } from '../../../../shared/ui/async-state/async-state';
import { ViewState, viewState } from '../../../../shared/ui/view-state';
import { formatCop } from '../../my-plan/my-plan.model';
import { AccountStatementGateway } from '../account-statement.gateway';
import {
  ACCOUNT_STATEMENT_FRAGMENT,
  AccountStatement,
  appendMovements,
  browserTimeZone,
  formatStatementInstant,
  planNameKey,
} from '../account-statement.model';

/**
 * «Estado de cuenta» de «Mi perfil» (HU007, ADR-036) para los tres actores. Muestra
 * la suscripción vigente con su oferta, periodo y próximo vencimiento, los
 * compromisos informativos (`PENDING_EXTERNAL`, `WAIVED`) y los movimientos
 * paginados por cursor, con importes en COP (`es-CO`) y fechas en la zona del
 * navegador con la zona visible (CA1). `PROVISIONING` y `NOT_APPLICABLE` son
 * estados explícitos, nunca errores (CA2). Solo se consulta la cuenta propia
 * (CA3). SportApp no registra pagos: la información financiera se presenta como
 * no confirmada y no hay saldo (CA4). «Cargar más» envía el cursor sin modificar
 * y agrega la página en el orden del BFF (CA5). Los datos solo viven en memoria.
 */
@Component({
  selector: 'app-account-statement-section',
  imports: [AsyncState, MatButtonModule, TranslatePipe],
  templateUrl: './account-statement-section.html',
  styleUrl: './account-statement-section.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountStatementSection {
  private readonly gateway = inject(AccountStatementGateway);
  private readonly locale = inject(LOCALE_ID);
  private readonly injector = inject(Injector);
  private readonly route = inject(ActivatedRoute, { optional: true });
  private readonly heading = viewChild.required<ElementRef<HTMLElement>>('heading');

  protected readonly fragment = ACCOUNT_STATEMENT_FRAGMENT;
  protected readonly timeZone = browserTimeZone();
  protected readonly state = signal<ViewState<AccountStatement>>(viewState.loading());
  protected readonly loadingMore = signal(false);
  protected readonly moreError = signal<ApiError | null>(null);

  protected readonly statement = computed(() => {
    const state = this.state();
    return state.status === 'success' ? state.data : null;
  });

  /** Solo la respuesta vigente actualiza la vista (recargas y páginas). */
  private generation = 0;
  private destroyed = false;
  private scrolled = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
    void this.load();
  }

  /** Primera página; también es el reintento y la recarga desde el inicio. */
  protected async load(): Promise<void> {
    const generation = ++this.generation;
    this.state.set(viewState.loading());
    this.loadingMore.set(false);
    this.moreError.set(null);
    try {
      const statement = await this.gateway.load();
      if (this.destroyed || generation !== this.generation) {
        return;
      }
      // Los cuatro estados son respuestas válidas: ninguno es un estado vacío (CA2).
      this.state.set(viewState.fromData(statement, () => false));
    } catch (error) {
      if (this.destroyed || generation !== this.generation) {
        return;
      }
      // Ningún error se presenta como una cuenta sin movimientos.
      this.state.set(viewState.fromError(error));
    }
    this.revealIfLinked();
  }

  protected async loadMore(): Promise<void> {
    const current = this.statement();
    if (current === null || current.nextCursor === null || this.loadingMore()) {
      return;
    }
    const generation = this.generation;
    this.loadingMore.set(true);
    this.moreError.set(null);
    try {
      const page = await this.gateway.loadMore(current.nextCursor);
      if (this.destroyed || generation !== this.generation) {
        return;
      }
      this.state.set({ status: 'success', data: appendMovements(current, page) });
    } catch (error) {
      if (this.destroyed || generation !== this.generation) {
        return;
      }
      // Lo ya mostrado se conserva; la persona decide reintentar.
      this.moreError.set(toApiError(error));
    }
    this.loadingMore.set(false);
  }

  /** Un cursor rechazado (`422`) no se reintenta: se vuelve a consultar desde el inicio. */
  protected cursorRejected(error: ApiError): boolean {
    return error.kind === 'validation';
  }

  protected amount(value: string): string {
    return formatCop(value);
  }

  protected instant(iso: string): string {
    return formatStatementInstant(iso, this.locale);
  }

  protected planKey(code: string): string | null {
    return planNameKey(code);
  }

  /** Desde el enlace de «Mi plan», lleva la sección a la vista y le da el foco. */
  private revealIfLinked(): void {
    if (this.scrolled || this.route?.snapshot.fragment !== ACCOUNT_STATEMENT_FRAGMENT) {
      return;
    }
    this.scrolled = true;
    afterNextRender(
      () => {
        const heading = this.heading().nativeElement;
        heading.scrollIntoView({ block: 'start' });
        heading.focus();
      },
      { injector: this.injector },
    );
  }
}
