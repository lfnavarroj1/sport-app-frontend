import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { CalendarItemView } from '../calendar-item/calendar-item';
import { CalendarItem, dayDate, integratedMonthWeeks } from '../integrated-calendar.model';

/**
 * Vista de mes del calendario integrado (HU018): una tabla de lunes a domingo
 * con cada elemento en su día en la zona del navegador (CA3).
 */
@Component({
  selector: 'app-integrated-month',
  imports: [CalendarItemView, DatePipe, TranslatePipe],
  templateUrl: './integrated-month.html',
  styleUrl: './integrated-month.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IntegratedMonth {
  readonly year = input.required<number>();
  /** Mes 0–11. */
  readonly month = input.required<number>();
  readonly items = input.required<readonly CalendarItem[]>();

  protected readonly weeks = computed(() =>
    integratedMonthWeeks(this.year(), this.month(), this.items()),
  );

  /** Primer día del mes, para el título de la tabla. */
  protected readonly firstDay = computed(() => new Date(this.year(), this.month(), 1));

  /** Lunes a domingo de una semana cualquiera, para los encabezados localizados. */
  protected readonly weekdays = Array.from({ length: 7 }, (_, i) => new Date(2027, 2, 1 + i));

  protected readonly dayDate = dayDate;
}
