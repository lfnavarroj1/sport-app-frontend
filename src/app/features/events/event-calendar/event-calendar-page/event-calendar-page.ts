import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { TranslatePipe } from '@ngx-translate/core';

import { ApiError, toApiError } from '../../../../core/api/api-error';
import { readErrorResponse } from '../../../../core/api/bff-web/contract';
import {
  EVENT_CONFLICTS_ERROR_CODES,
  PUBLISHED_EVENTS_ERROR_CODES,
  PUBLISHED_EVENTS_ISSUES,
} from '../../../../core/api/bff-web/events.api';
import { FieldError } from '../../../../shared/forms/field-error/field-error';
import { AsyncState } from '../../../../shared/ui/async-state/async-state';
import { ViewState, viewState } from '../../../../shared/ui/view-state';
import { browserTimeZone } from '../../create-event/event-time';
import { OrganizerEvent } from '../../publish-event/publish-event.model';
import { CalendarEventItem } from '../calendar-event-item/calendar-event-item';
import { CalendarMonth } from '../calendar-month/calendar-month';
import { EventCalendarGateway } from '../event-calendar.gateway';
import {
  CalendarEvent,
  CalendarQuery,
  CalendarViolation,
  ConflictReason,
  EventConflicts,
  MAX_PERIOD_DAYS,
  daysPeriod,
  localDayKey,
  monthPeriod,
  periodIssue,
} from '../event-calendar.model';

export type CalendarMode = 'month' | 'list';

interface MonthRef {
  readonly year: number;
  /** 0–11. */
  readonly month: number;
}

/** Primera página cargada: base de la vista. */
interface LoadedEvents {
  readonly events: readonly CalendarEvent[];
}

const KNOWN_ISSUES: readonly string[] = PUBLISHED_EVENTS_ISSUES;
const VALIDATION_ERROR = PUBLISHED_EVENTS_ERROR_CODES.validationError;

const notBlank = (control: AbstractControl<string>): ValidationErrors | null =>
  control.value && control.value.trim() === '' ? { required: true } : null;

/**
 * Calendario de eventos del organizador (HU023, ADR-040) en
 * `/organizador/eventos/calendario`.
 *
 * - Muestra los eventos **publicados** del periodo en vista de mes o de lista,
 *   en el orden del backend y con «Cargar más» por cursor (CA1, CA4). Los
 *   horarios se presentan en la zona del navegador con la zona del evento
 *   visible.
 * - Filtra por disciplina y ciudad; la igualdad sin mayúsculas ni acentos la
 *   aplica el backend.
 * - Valida el periodo con la misma regla del backend (fin posterior al inicio y
 *   hasta 92 días); un `422` del backend se informa por campo (CA3).
 * - Al elegir un evento propio, el BFF calcula las coincidencias y la pantalla
 *   las resalta con sus motivos (CA2). Son información de apoyo: no bloquean ni
 *   reservan nada. No hay inscripción ni edición desde aquí.
 */
@Component({
  selector: 'app-event-calendar-page',
  imports: [
    AsyncState,
    CalendarEventItem,
    CalendarMonth,
    DatePipe,
    FieldError,
    MatButtonModule,
    MatButtonToggleModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    ReactiveFormsModule,
    TranslatePipe,
  ],
  templateUrl: './event-calendar-page.html',
  styleUrls: ['../../create-event/events-page.scss', './event-calendar-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventCalendarPage {
  private readonly gateway = inject(EventCalendarGateway);
  private readonly injector = inject(Injector);

  protected readonly maxDays = MAX_PERIOD_DAYS;
  protected readonly browserZone = browserTimeZone();

  protected readonly mode = signal<CalendarMode>('month');
  protected readonly month = signal<MonthRef>(currentMonth());
  protected readonly monthStart = computed(
    () => new Date(this.month().year, this.month().month, 1),
  );

  protected readonly filters = new FormGroup({
    from: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    to: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    discipline: new FormControl('', { nonNullable: true, validators: [notBlank] }),
    city: new FormControl('', { nonNullable: true, validators: [notBlank] }),
  });

  /** Consulta aplicada: la que respalda los eventos mostrados y «Cargar más». */
  private readonly query = signal<CalendarQuery | null>(null);
  protected readonly state = signal<ViewState<LoadedEvents>>(viewState.loading());
  protected readonly events = signal<readonly CalendarEvent[]>([]);
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly loadingMore = signal(false);
  protected readonly moreError = signal<ApiError | null>(null);
  /** Reglas incumplidas que informó el backend en el último `422` (CA3). */
  protected readonly violations = signal<readonly CalendarViolation[]>([]);

  protected readonly ownEvents = signal<ViewState<readonly OrganizerEvent[]>>(viewState.loading());
  protected readonly selectedOwn = new FormControl<string | null>(null);
  protected readonly selectedOwnEvent = signal<OrganizerEvent | null>(null);
  protected readonly conflictsState = signal<ViewState<EventConflicts> | null>(null);

  /** Coincidencias por evento publicado, para resaltarlas en el mes y la lista. */
  protected readonly conflictReasons = computed(() => {
    const state = this.conflictsState();
    const map = new Map<string, readonly ConflictReason[]>();
    if (state?.status === 'success') {
      for (const conflict of state.data.conflicts) {
        map.set(conflict.id, conflict.reasons);
      }
    }
    return map;
  });

  protected readonly conflictsNotFound = computed(() => {
    const state = this.conflictsState();
    return (
      state?.status === 'error' && state.error.code === EVENT_CONFLICTS_ERROR_CODES.eventNotFound
    );
  });

  /** Evita que una respuesta de una carga anterior pise la vigente. */
  private generation = 0;
  private conflictsGeneration = 0;
  private readonly list = viewChild<ElementRef<HTMLElement>>('list');

  constructor() {
    this.setListDatesFromMonth();
    void this.applyFilters();
    void this.loadOwnEvents();
    this.selectedOwn.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((eventId) => void this.selectOwn(eventId));
  }

  protected setMode(mode: CalendarMode): void {
    if (mode === this.mode()) {
      return;
    }
    if (mode === 'list') {
      this.setListDatesFromMonth();
    } else {
      const from = this.filters.controls.from.value;
      if (from) {
        const [year, month] = from.split('-').map(Number);
        this.month.set({ year, month: month - 1 });
      }
    }
    this.mode.set(mode);
    void this.applyFilters();
  }

  protected shiftMonth(delta: number): void {
    const { year, month } = this.month();
    const target = new Date(year, month + delta, 1);
    this.month.set({ year: target.getFullYear(), month: target.getMonth() });
    void this.applyFilters();
  }

  /** Lleva el calendario al mes en que empieza el evento propio elegido. */
  protected showOwnEventMonth(): void {
    const event = this.selectedOwnEvent();
    if (event === null) {
      return;
    }
    const start = new Date(event.startsAt);
    this.month.set({ year: start.getFullYear(), month: start.getMonth() });
    this.mode.set('month');
    this.setListDatesFromMonth();
    void this.applyFilters();
  }

  /** Valida el periodo y los filtros con las reglas del contrato y consulta la primera página. */
  protected async applyFilters(): Promise<void> {
    const query = this.buildQuery();
    if (query === null) {
      return;
    }
    this.query.set(query);
    await this.loadFirst();
  }

  /** Primera página de la consulta aplicada; también es el reintento. */
  protected async loadFirst(): Promise<void> {
    const query = this.query();
    if (query === null) {
      return;
    }
    const generation = ++this.generation;
    this.state.set(viewState.loading());
    this.events.set([]);
    this.nextCursor.set(null);
    this.moreError.set(null);
    this.violations.set([]);
    // Una página siguiente en curso queda descartada: su `finally` ya no la libera.
    this.loadingMore.set(false);
    try {
      const page = await this.gateway.loadEvents(query, null);
      if (generation !== this.generation) {
        return;
      }
      this.events.set(page.events);
      this.nextCursor.set(page.nextCursor);
      this.state.set(
        viewState.fromData({ events: page.events }, (data) => data.events.length === 0),
      );
    } catch (error) {
      if (generation === this.generation) {
        this.violations.set(violationsOf(error));
        this.markViolations();
        this.state.set(viewState.fromError(error));
      }
    }
  }

  /** Página siguiente con el cursor tal como lo entregó el backend y la misma consulta. */
  protected async loadMore(): Promise<void> {
    const cursor = this.nextCursor();
    const query = this.query();
    if (cursor === null || query === null || this.loadingMore()) {
      return;
    }
    const generation = this.generation;
    const firstNew = this.events().length;
    this.loadingMore.set(true);
    this.moreError.set(null);
    try {
      const page = await this.gateway.loadEvents(query, cursor);
      if (generation !== this.generation) {
        return;
      }
      this.events.update((events) => [...events, ...page.events]);
      this.nextCursor.set(page.nextCursor);
      this.focusEvent(firstNew);
    } catch (error) {
      if (generation === this.generation) {
        // Los eventos ya cargados se conservan; solo falla la página siguiente.
        this.moreError.set(toApiError(error));
      }
    } finally {
      if (generation === this.generation) {
        this.loadingMore.set(false);
      }
    }
  }

  protected async loadOwnEvents(): Promise<void> {
    this.ownEvents.set(viewState.loading());
    try {
      this.ownEvents.set(viewState.fromData(await this.gateway.loadOwnEvents()));
    } catch (error) {
      this.ownEvents.set(viewState.fromError(error));
    }
  }

  protected async reloadConflicts(): Promise<void> {
    await this.selectOwn(this.selectedOwn.value);
  }

  protected ownEventList(): readonly OrganizerEvent[] {
    const state = this.ownEvents();
    return state.status === 'success' ? state.data : [];
  }

  protected reasonsFor(eventId: string): readonly ConflictReason[] {
    return this.conflictReasons().get(eventId) ?? [];
  }

  protected violationKey(issue: string): string {
    return `events.calendar.issues.${KNOWN_ISSUES.includes(issue) ? issue : 'unknown'}`;
  }

  protected violationFieldKey(field: string): string {
    const known = ['from', 'to', 'discipline', 'city', 'cursor', 'limit'];
    return `events.calendar.fields.${known.includes(field) ? field : 'query'}`;
  }

  private async selectOwn(eventId: string | null): Promise<void> {
    const generation = ++this.conflictsGeneration;
    this.selectedOwnEvent.set(this.ownEventList().find((event) => event.id === eventId) ?? null);
    if (eventId === null) {
      this.conflictsState.set(null);
      return;
    }
    this.conflictsState.set(viewState.loading());
    try {
      const conflicts = await this.gateway.loadConflicts(eventId);
      if (generation === this.conflictsGeneration) {
        this.conflictsState.set(viewState.fromData(conflicts, () => false));
      }
    } catch (error) {
      if (generation === this.conflictsGeneration) {
        this.conflictsState.set(viewState.fromError(error));
      }
    }
  }

  private buildQuery(): CalendarQuery | null {
    const controls = this.filters.controls;
    const filtersValid = controls.discipline.valid && controls.city.valid;
    let period;
    if (this.mode() === 'month') {
      const { year, month } = this.month();
      period = monthPeriod(year, month);
    } else {
      controls.from.markAsTouched();
      controls.to.markAsTouched();
      if (controls.from.invalid || controls.to.invalid) {
        return null;
      }
      const issue = periodIssue(controls.from.value, controls.to.value);
      if (issue !== null) {
        controls.to.setErrors({ ...controls.to.errors, period: issue });
        return null;
      }
      period = daysPeriod(controls.from.value, controls.to.value);
    }
    if (!filtersValid) {
      controls.discipline.markAsTouched();
      controls.city.markAsTouched();
      return null;
    }
    return {
      period,
      discipline: blankToNull(controls.discipline.value),
      city: blankToNull(controls.city.value),
    };
  }

  /** Marca en su campo las reglas que informó el backend (periodo, disciplina o ciudad). */
  private markViolations(): void {
    const controls = this.filters.controls;
    for (const violation of this.violations()) {
      const control =
        violation.field === 'from' || violation.field === 'to'
          ? this.mode() === 'list'
            ? controls.to
            : null
          : violation.field === 'discipline' || violation.field === 'city'
            ? controls[violation.field]
            : null;
      if (control) {
        control.setErrors({ ...control.errors, server: violation.issue });
        control.markAsTouched();
      }
    }
  }

  private setListDatesFromMonth(): void {
    const { year, month } = this.month();
    const last = new Date(year, month + 1, 0);
    this.filters.patchValue(
      { from: localDayKey(new Date(year, month, 1)), to: localDayKey(last) },
      { emitEvent: false },
    );
  }

  /** Lleva el foco al primer evento agregado para seguir con el teclado. */
  private focusEvent(index: number): void {
    afterNextRender(
      () =>
        this.list()
          ?.nativeElement.querySelectorAll<HTMLElement>('li[data-event]')
          .item(index)
          ?.focus(),
      { injector: this.injector },
    );
  }
}

function currentMonth(): MonthRef {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() };
}

function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** `details[].field` llega como `query.<parámetro>`; se conserva el parámetro. */
function violationsOf(error: unknown): CalendarViolation[] {
  if (!(error instanceof HttpErrorResponse) || error.status !== 422) {
    return [];
  }
  const body = readErrorResponse(error.error);
  if (body?.code !== VALIDATION_ERROR) {
    return [];
  }
  return (body.details ?? []).map((detail) => ({
    field: (detail.field ?? '').replace(/^query\.?/, ''),
    issue: detail.issue,
  }));
}
