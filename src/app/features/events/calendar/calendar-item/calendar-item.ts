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

import {
  SERVICE_CATEGORIES,
  SERVICE_MODALITIES,
} from '../../../../core/api/bff-web/services-availability.api';
import { SPORTS } from '../../../../core/api/bff-web/training.api';
import { browserTimeZone, formatInZone } from '../../create-event/event-time';
import { CalendarItem } from '../integrated-calendar.model';

const KNOWN_SPORTS: readonly string[] = SPORTS;
const KNOWN_CATEGORIES: readonly string[] = SERVICE_CATEGORIES;
const KNOWN_MODALITIES: readonly string[] = SERVICE_MODALITIES;

/**
 * Un elemento del calendario integrado (HU018): su fuente y su estado dichos con
 * texto (CA1), el horario en la zona del navegador y la zona declarada por el
 * dominio cuando difiere (CA3). Una sesión de plan no tiene hora: se muestra en
 * su fecha. Los textos de catálogo solo se traducen si el valor es conocido; si
 * no, se muestran tal como llegan.
 */
@Component({
  selector: 'app-calendar-item',
  imports: [DatePipe, TranslatePipe],
  templateUrl: './calendar-item.html',
  styleUrl: './calendar-item.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'calendar-item',
    '[class.calendar-item--draft]': "item().status === 'DRAFT'",
    '[attr.data-source]': 'item().source',
  },
})
export class CalendarItemView {
  readonly item = input.required<CalendarItem>();
  /** Presentación reducida dentro de una celda del mes. */
  readonly compact = input(false);

  private readonly locale = inject(LOCALE_ID);
  private readonly browserZone = browserTimeZone();

  /** Hora del elemento en su propia zona cuando difiere de la del navegador. */
  protected readonly zonedStart = computed(() => {
    const { startsAt, timeZone } = this.item();
    return startsAt === null || timeZone === null || timeZone === this.browserZone
      ? null
      : formatInZone(startsAt, timeZone, this.locale);
  });

  /** El elemento termina otro día (en la zona del navegador). */
  protected readonly spansDays = computed(() => {
    const { startsAt, endsAt } = this.item();
    return (
      startsAt !== null &&
      endsAt !== null &&
      new Date(startsAt).toDateString() !== new Date(endsAt).toDateString()
    );
  });

  protected sportKey(sport: string): string | null {
    return KNOWN_SPORTS.includes(sport) ? `training.sports.${sport}` : null;
  }

  protected categoryKey(category: string): string | null {
    return KNOWN_CATEGORIES.includes(category)
      ? `services.availability.categories.${category}`
      : null;
  }

  protected modalityKey(modality: string): string | null {
    return KNOWN_MODALITIES.includes(modality)
      ? `services.availability.modalities.${modality}`
      : null;
  }
}
