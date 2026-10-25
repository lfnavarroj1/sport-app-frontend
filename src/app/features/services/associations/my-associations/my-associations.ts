import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  LOCALE_ID,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxChange, MatCheckboxModule } from '@angular/material/checkbox';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { ApiError } from '../../../../core/api/api-error';
import { AsyncState } from '../../../../shared/ui/async-state/async-state';
import { formatPrice } from '../../availability/availability-format';
import { COMPARE_PLANS_ROUTE, failureMessageKey, formatInstant } from '../association-format';
import { ServiceAssociation } from '../service-associations.model';
import { ServiceAssociationsStore, retryable } from '../service-associations.store';

/**
 * «Mis servicios asociados» (HU017): las asociaciones del deportista a servicios
 * médicos deportivos, de la más reciente a la más antigua, con «Cargar más» y la
 * opción de ver también el historial de las quitadas (`status=ALL`, CA5). Cada
 * asociación activa se puede quitar tras confirmar.
 *
 * Si el plan ya no incluye la capacidad (`403 capability_required`) se explica y
 * se lleva a «Comparar planes» (HU016), sin mostrar datos.
 */
@Component({
  selector: 'app-my-associations',
  imports: [AsyncState, MatButtonModule, MatCheckboxModule, RouterLink, TranslatePipe],
  templateUrl: './my-associations.html',
  styleUrl: './my-associations.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MyAssociations {
  protected readonly store = inject(ServiceAssociationsStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly locale = inject(LOCALE_ID);

  protected readonly comparePlansRoute = COMPARE_PLANS_ROUTE;
  /** Asociación con la confirmación de quitar abierta, o `null`. */
  protected readonly confirming = signal<string | null>(null);
  protected readonly busy = computed(
    () => this.store.associating() !== null || this.store.dissociating() !== null,
  );

  constructor() {
    this.store.ensureLoaded();
  }

  protected toggleHistory(change: MatCheckboxChange): void {
    this.confirming.set(null);
    this.store.setFilter(change.checked ? 'ALL' : 'ACTIVE');
  }

  protected askDissociate(association: ServiceAssociation): void {
    this.confirming.set(association.id);
    this.focus(`association-confirm-${association.id}`);
  }

  protected cancel(association: ServiceAssociation): void {
    this.confirming.set(null);
    this.focus(`association-dissociate-${association.id}`);
  }

  protected async dissociate(association: ServiceAssociation): Promise<void> {
    await this.store.dissociate(association, 'list');
    this.confirming.set(null);
    this.focus(
      this.store.message(association.serviceId, 'list')?.kind === 'failed'
        ? `association-error-${association.id}`
        : 'associations-notice',
    );
  }

  /** Solo la asociación activa del servicio muestra el resultado de quitarla. */
  protected failure(association: ServiceAssociation): ApiError | null {
    const message = this.store.message(association.serviceId, 'list');
    return association.status === 'ACTIVE' && message?.kind === 'failed' ? message.error : null;
  }

  protected failureKey(error: ApiError): string {
    return failureMessageKey(error);
  }

  protected retryable(error: ApiError): boolean {
    return retryable(error);
  }

  protected price(amount: string): string {
    return formatPrice(amount);
  }

  protected instant(value: string): string {
    return formatInstant(value, this.locale);
  }

  private focus(testId: string): void {
    afterNextRender(
      () =>
        this.host.nativeElement.querySelector<HTMLElement>(`[data-testid="${testId}"]`)?.focus(),
      { injector: this.injector },
    );
  }
}
