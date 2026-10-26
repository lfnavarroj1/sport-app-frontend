import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { filter, startWith } from 'rxjs';

import { OrganizerEvent } from '../../publish-event/publish-event.model';
import { OwnEventsStore } from '../own-events.store';

/**
 * Inscritos de los eventos propios (HU022, ADR-039) en
 * `/organizador/eventos/inscritos`: vista maestra con el selector de evento
 * propio (`GET /v1/me/events`, borradores y publicados). Elegir un evento abre
 * `:eventId` a su lado con los conteos, el filtro y la lista paginada. No hay
 * exportación ni datos de contacto.
 */
@Component({
  selector: 'app-event-attendees-page',
  imports: [
    DatePipe,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatSelectModule,
    RouterOutlet,
    TranslatePipe,
  ],
  templateUrl: './event-attendees-page.html',
  styleUrls: ['../../create-event/events-page.scss', './event-attendees-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventAttendeesPage {
  private readonly store = inject(OwnEventsStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly events = this.store.view;
  /** Evento abierto en `:eventId`, o `null`. */
  protected readonly selectedId = signal<string | null>(null);

  constructor() {
    void this.store.load();
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        startWith(null),
        takeUntilDestroyed(),
      )
      .subscribe(() =>
        this.selectedId.set(this.route.firstChild?.snapshot?.paramMap.get('eventId') ?? null),
      );
  }

  protected reload(): void {
    void this.store.load();
  }

  protected select(eventId: string): void {
    void this.router.navigate([eventId], { relativeTo: this.route });
  }

  protected list(): readonly OrganizerEvent[] {
    const state = this.events();
    return state.status === 'success' ? state.data : [];
  }
}
