import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { CalendarEventItem } from '../calendar-event-item/calendar-event-item';
import { CalendarEvent, ConflictReason, monthWeeks } from '../event-calendar.model';

const NO_REASONS: readonly ConflictReason[] = [];

/**
 * Vista de mes del calendario (HU023): una tabla de lunes a domingo con los
 * eventos ubicados en el día en que empiezan, en la zona del navegador. Los
 * eventos que coinciden con el evento propio elegido llevan sus motivos.
 */
@Component({
  selector: 'app-calendar-month',
  imports: [CalendarEventItem, DatePipe, TranslatePipe],
  templateUrl: './calendar-month.html',
  styleUrl: './calendar-month.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CalendarMonth {
  readonly year = input.required<number>();
  /** Mes 0–11. */
  readonly month = input.required<number>();
  readonly events = input.required<readonly CalendarEvent[]>();
  readonly conflicts = input<ReadonlyMap<string, readonly ConflictReason[]>>(new Map());
  readonly ownEventId = input<string | null>(null);

  protected readonly weeks = computed(() => monthWeeks(this.year(), this.month(), this.events()));

  /** Primer día del mes, para el título de la tabla. */
  protected readonly firstDay = computed(() => new Date(this.year(), this.month(), 1));

  /** Lunes a domingo de una semana cualquiera, para los encabezados localizados. */
  protected readonly weekdays = Array.from({ length: 7 }, (_, i) => new Date(2027, 2, 1 + i));

  protected reasonsFor(eventId: string): readonly ConflictReason[] {
    return this.conflicts().get(eventId) ?? NO_REASONS;
  }

  protected dayDate(key: string): Date {
    const [year, month, day] = key.split('-').map(Number);
    return new Date(year, month - 1, day);
  }
}
