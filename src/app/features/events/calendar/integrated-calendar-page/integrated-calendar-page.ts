import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { TranslatePipe } from '@ngx-translate/core';

import { readErrorResponse } from '../../../../core/api/bff-web/contract';
import {
  INTEGRATED_CALENDAR_ERROR_CODES,
  INTEGRATED_CALENDAR_ISSUES,
} from '../../../../core/api/bff-web/integrated-calendar.api';
import { SessionStore } from '../../../../core/session/session.store';
import { FieldError } from '../../../../shared/forms/field-error/field-error';
import { AsyncState } from '../../../../shared/ui/async-state/async-state';
import { ViewState, viewState } from '../../../../shared/ui/view-state';
import { browserTimeZone } from '../../create-event/event-time';
import {
  CalendarPeriod,
  MAX_PERIOD_DAYS,
  daysPeriod,
  localDayKey,
  monthPeriod,
  periodIssue,
} from '../../event-calendar/event-calendar.model';
import { CalendarItemView } from '../calendar-item/calendar-item';
import { IntegratedCalendarGateway } from '../integrated-calendar.gateway';
import {
  CalendarSource,
  IntegratedCalendar,
  countBySource,
  dayDate,
  groupByDay,
  incompleteSources,
  itemsOfSources,
  sourceKey,
  sourceStatusKey,
  truncatedSources,
} from '../integrated-calendar.model';
import { IntegratedMonth } from '../integrated-month/integrated-month';

export type CalendarMode = 'month' | 'list';

interface MonthRef {
  readonly year: number;
  /** 0–11. */
  readonly month: number;
}

/** Regla incumplida que informa el backend (`422 validation_error`, CA6). */
interface PeriodViolation {
  /** Parámetro sin el prefijo `query.` (`from`, `to`); vacío si no se indica. */
  readonly field: string;
  readonly issue: string;
}

const KNOWN_ISSUES: readonly string[] = INTEGRATED_CALENDAR_ISSUES;

/**
 * Calendario integrado de eventos y servicios (HU018, ADR-039) en
 * `/organizador/calendario`, `/profesional/calendario` y `/deportista/calendario`.
 *
 * - El BFF compone las fuentes del actor de la sesión; la pantalla no une
 *   respuestas de varios dominios ni decide qué es visible (CA1, CA4).
 * - Vista de mes o de lista; los horarios se presentan en la zona del navegador
 *   con la zona declarada por el dominio (CA3).
 * - El filtro por fuente solo oculta elementos ya recibidos.
 * - Una fuente que no respondió se declara como información incompleta y nunca
 *   se afirma que no haya actividades; una fuente truncada sugiere acotar el
 *   periodo (CA5, CA6). Todas caídas → error con referencia y reintento.
 * - Valida el periodo con la regla del backend (hasta 92 días); un `422` se
 *   informa junto al campo (CA6).
 */
@Component({
  selector: 'app-integrated-calendar-page',
  imports: [
    AsyncState,
    CalendarItemView,
    DatePipe,
    FieldError,
    IntegratedMonth,
    MatButtonModule,
    MatButtonToggleModule,
    MatCardModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    ReactiveFormsModule,
    TranslatePipe,
  ],
  templateUrl: './integrated-calendar-page.html',
  styleUrls: [
    '../../create-event/events-page.scss',
    '../../event-calendar/event-calendar-page/event-calendar-page.scss',
    './integrated-calendar-page.scss',
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IntegratedCalendarPage {
  private readonly gateway = inject(IntegratedCalendarGateway);

  protected readonly maxDays = MAX_PERIOD_DAYS;
  protected readonly browserZone = browserTimeZone();
  /** El texto de la pantalla depende del actor; sus fuentes las decide el BFF. */
  protected readonly actor = inject(SessionStore).user()?.actorType ?? 'athlete';

  protected readonly mode = signal<CalendarMode>('month');
  protected readonly month = signal<MonthRef>(currentMonth());
  protected readonly monthStart = computed(
    () => new Date(this.month().year, this.month().month, 1),
  );

  protected readonly period = new FormGroup({
    from: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    to: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  /** Periodo aplicado: el que respalda lo mostrado y el reintento. */
  private readonly applied = signal<CalendarPeriod | null>(null);
  protected readonly state = signal<ViewState<IntegratedCalendar>>(viewState.loading());
  protected readonly violations = signal<readonly PeriodViolation[]>([]);
  /** Fuentes ocultas por el filtro; se conservan al cambiar de periodo. */
  private readonly hidden = signal<ReadonlySet<CalendarSource>>(new Set());

  protected readonly calendar = computed(() => {
    const state = this.state();
    return state.status === 'success' ? state.data : null;
  });
  protected readonly incomplete = computed(() => incompleteSources(this.calendar()?.sources ?? []));
  protected readonly truncated = computed(() => truncatedSources(this.calendar()?.sources ?? []));
  protected readonly counts = computed(() => countBySource(this.calendar()?.items ?? []));
  protected readonly selected = computed(
    () =>
      new Set(
        (this.calendar()?.sources ?? [])
          .map((source) => source.name)
          .filter((name) => !this.hidden().has(name)),
      ),
  );
  protected readonly visibleItems = computed(() =>
    itemsOfSources(this.calendar()?.items ?? [], this.selected()),
  );
  protected readonly days = computed(() => groupByDay(this.visibleItems()));

  protected readonly dayDate = dayDate;
  protected readonly sourceKey = sourceKey;
  protected readonly sourceStatusKey = sourceStatusKey;

  /** Evita que una respuesta de una carga anterior pise la vigente. */
  private generation = 0;

  constructor() {
    this.setListDatesFromMonth();
    void this.apply();
  }

  protected setMode(mode: CalendarMode): void {
    if (mode === this.mode()) {
      return;
    }
    if (mode === 'list') {
      this.setListDatesFromMonth();
    } else {
      const from = this.period.controls.from.value;
      if (from) {
        const [year, month] = from.split('-').map(Number);
        this.month.set({ year, month: month - 1 });
      }
    }
    this.mode.set(mode);
    void this.apply();
  }

  protected shiftMonth(delta: number): void {
    const { year, month } = this.month();
    const target = new Date(year, month + delta, 1);
    this.month.set({ year: target.getFullYear(), month: target.getMonth() });
    void this.apply();
  }

  /** Valida el periodo con la regla del contrato y consulta el calendario. */
  protected async apply(): Promise<void> {
    const period = this.buildPeriod();
    if (period === null) {
      return;
    }
    this.applied.set(period);
    await this.load();
  }

  /** Consulta el periodo aplicado; también es el reintento. */
  protected async load(): Promise<void> {
    const period = this.applied();
    if (period === null) {
      return;
    }
    const generation = ++this.generation;
    this.state.set(viewState.loading());
    this.violations.set([]);
    try {
      const calendar = await this.gateway.load(period);
      if (generation === this.generation) {
        // El vacío se decide en la plantilla: sin elementos y con una fuente caída
        // no se afirma que no haya actividades (CA5).
        this.state.set(viewState.fromData(calendar, () => false));
      }
    } catch (error) {
      if (generation === this.generation) {
        this.violations.set(violationsOf(error));
        this.markViolations();
        this.state.set(viewState.fromError(error));
      }
    }
  }

  protected toggleSource(source: CalendarSource, visible: boolean): void {
    this.hidden.update((hidden) => {
      const next = new Set(hidden);
      if (visible) {
        next.delete(source);
      } else {
        next.add(source);
      }
      return next;
    });
  }

  protected countOf(source: CalendarSource): number {
    return this.counts().get(source) ?? 0;
  }

  protected violationKey(issue: string): string {
    return `events.integratedCalendar.issues.${KNOWN_ISSUES.includes(issue) ? issue : 'unknown'}`;
  }

  protected violationFieldKey(field: string): string {
    return `events.integratedCalendar.fields.${field === 'from' || field === 'to' ? field : 'period'}`;
  }

  private buildPeriod(): CalendarPeriod | null {
    if (this.mode() === 'month') {
      const { year, month } = this.month();
      return monthPeriod(year, month);
    }
    const controls = this.period.controls;
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
    return daysPeriod(controls.from.value, controls.to.value);
  }

  /** En la vista de lista, marca en «Hasta» la regla del periodo que informó el backend. */
  private markViolations(): void {
    if (this.mode() !== 'list' || this.violations().length === 0) {
      return;
    }
    const control = this.period.controls.to;
    control.setErrors({ ...control.errors, server: this.violations()[0].issue });
    control.markAsTouched();
  }

  private setListDatesFromMonth(): void {
    const { year, month } = this.month();
    this.period.patchValue(
      {
        from: localDayKey(new Date(year, month, 1)),
        to: localDayKey(new Date(year, month + 1, 0)),
      },
      { emitEvent: false },
    );
  }
}

function currentMonth(): MonthRef {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() };
}

/** `details[].field` llega como `query.<parámetro>`; se conserva el parámetro. */
function violationsOf(error: unknown): PeriodViolation[] {
  if (!(error instanceof HttpErrorResponse) || error.status !== 422) {
    return [];
  }
  const body = readErrorResponse(error.error);
  if (body?.code !== INTEGRATED_CALENDAR_ERROR_CODES.validationError) {
    return [];
  }
  return (body.details ?? []).map((detail) => ({
    field: (detail.field ?? '').replace(/^query\.?/, ''),
    issue: detail.issue,
  }));
}
