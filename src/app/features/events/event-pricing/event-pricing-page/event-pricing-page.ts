import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  LOCALE_ID,
  computed,
  inject,
  signal,
} from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { AsyncState } from '../../../../shared/ui/async-state/async-state';
import { formatInZone } from '../../create-event/event-time';
import { PricedEvent, formatCop, isFree } from '../event-pricing.model';
import { EventPricingStore } from '../event-pricing.store';

/**
 * Tarifas de los eventos propios (HU025, ADR-040) en `/organizador/eventos/tarifas`:
 * vista maestra con los eventos (`GET /v1/me/events`, borradores y publicados),
 * su tarifa en `COP` con formato `es-CO` y sus inscripciones vigentes. Elegir un
 * evento abre `:eventId` a su lado para asignar o retirar la tarifa.
 */
@Component({
  selector: 'app-event-pricing-page',
  imports: [
    AsyncState,
    DatePipe,
    MatCardModule,
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    TranslatePipe,
  ],
  templateUrl: './event-pricing-page.html',
  styleUrls: ['../../create-event/events-page.scss', './event-pricing-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventPricingPage {
  private readonly store = inject(EventPricingStore);
  private readonly locale = inject(LOCALE_ID);

  protected readonly events = this.store.view;
  protected readonly list = computed<readonly PricedEvent[]>(() => {
    const state = this.events();
    return state.status === 'success' ? state.data : [];
  });

  /** Hay un evento abierto en `:eventId`. */
  protected readonly detailOpen = signal(false);

  constructor() {
    void this.store.load();
  }

  protected reload(): void {
    void this.store.load();
  }

  /** Clave i18n o importe formateado de la tarifa de la fila. */
  protected feeText(event: PricedEvent): { key: string; amount: string | null } {
    if (event.fee === null) {
      return { key: 'events.pricing.fee.none', amount: null };
    }
    if (isFree(event.fee)) {
      return { key: 'events.pricing.fee.free', amount: null };
    }
    return { key: 'events.pricing.fee.amount', amount: formatCop(event.fee.amount) };
  }

  protected inZone(event: PricedEvent): string {
    return formatInZone(event.startsAt, event.timeZone, this.locale);
  }
}
