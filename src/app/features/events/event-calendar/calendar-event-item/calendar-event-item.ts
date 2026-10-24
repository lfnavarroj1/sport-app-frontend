import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  LOCALE_ID,
  computed,
  inject,
  input,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { browserTimeZone, formatInZone } from '../../create-event/event-time';
import { ConflictReason } from '../event-calendar.model';

/** Lo que el calendario presenta de un evento: publicado o coincidencia. */
export interface CalendarEntry {
  readonly name: string;
  readonly discipline: string;
  readonly city: string;
  /** Instantes ISO 8601 en UTC. */
  readonly startsAt: string;
  readonly endsAt: string;
  readonly timeZone: string;
}

/**
 * Un evento del calendario (HU023): nombre, disciplina y ciudad, horario en la
 * zona del navegador y la zona del evento siempre visible (CA4). Si el evento
 * coincide con el evento propio elegido, se dicen sus motivos con texto, no solo
 * con color (CA2).
 */
@Component({
  selector: 'app-calendar-event-item',
  imports: [DatePipe, TranslatePipe],
  templateUrl: './calendar-event-item.html',
  styleUrl: './calendar-event-item.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'calendar-event',
    '[class.calendar-event--conflict]': 'reasons().length > 0',
    '[class.calendar-event--own]': 'own()',
  },
})
export class CalendarEventItem {
  readonly entry = input.required<CalendarEntry>();
  /** Motivos de coincidencia con el evento propio elegido; vacío si no coincide. */
  readonly reasons = input<readonly ConflictReason[]>([]);
  /** Es el evento propio elegido. */
  readonly own = input(false);
  /** Presentación reducida dentro de una celda del mes. */
  readonly compact = input(false);

  private readonly locale = inject(LOCALE_ID);
  private readonly browserZone = browserTimeZone();

  /** Hora del evento en su propia zona cuando difiere de la del navegador. */
  protected readonly eventLocalStart = computed(() => {
    const entry = this.entry();
    return entry.timeZone === this.browserZone
      ? null
      : formatInZone(entry.startsAt, entry.timeZone, this.locale);
  });

  /** El evento termina otro día (en la zona del navegador). */
  protected readonly spansDays = computed(() => {
    const entry = this.entry();
    return new Date(entry.startsAt).toDateString() !== new Date(entry.endsAt).toDateString();
  });
}
