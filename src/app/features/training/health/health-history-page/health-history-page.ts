import { DatePipe } from '@angular/common';
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
import { FormControl, FormGroup, FormGroupDirective, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { ApiError, toApiError } from '../../../../core/api/api-error';
import { HEALTH_REPORTS_ERROR_CODES } from '../../../../core/api/bff-web/health-reports.api';
import { AsyncState } from '../../../../shared/ui/async-state/async-state';
import { ViewState, viewState } from '../../../../shared/ui/view-state';
import { HealthHistoryGateway } from '../health-history.gateway';
import {
  HEALTH_SEVERITY_OPTIONS,
  HEALTH_TYPE_OPTIONS,
  HealthFilters,
  HealthReport,
  HealthReportType,
  HealthScope,
  HealthSeverity,
  NO_HEALTH_FILTERS,
  hasHealthFilters,
  recoveryText,
} from '../health-history.model';

/** Errores que la pantalla explica con un mensaje propio, sin datos (CA3, CA6). */
const OWN_MESSAGE_CODES: Readonly<Record<string, string>> = {
  [HEALTH_REPORTS_ERROR_CODES.athleteAuthorizationRequired]:
    'training.health.errors.athleteNotAuthorized',
  [HEALTH_REPORTS_ERROR_CODES.permissionRequired]: 'training.health.errors.permissionRequired',
  [HEALTH_REPORTS_ERROR_CODES.validationError]: 'training.health.errors.invalidFilters',
};

/** Primera página cargada: base de la vista. */
interface LoadedReports {
  readonly reports: readonly HealthReport[];
}

/**
 * Historial de molestias, incapacidades o lesiones (HU012, ADR-037): reportes de
 * HU042 en el orden estable del backend (`occurred_at` y `report_id`
 * descendentes), con filtros por periodo, tipo y severidad, paginación por cursor
 * («Cargar más») y aviso de sensibilidad. Los reportes no son un diagnóstico: la
 * pantalla solo muestra lo registrado, sin interpretación clínica.
 *
 * El mismo componente sirve al deportista (`scope: own`) y al profesional
 * autorizado (`:athleteId`). La autorización la decide el backend: un `403` se
 * explica sin mostrar datos ni revelar si el deportista existe (CA3), y un `422`
 * de periodo o filtros se explica junto a los filtros (CA6). Una página nueva se
 * agrega tal como llega, sin reordenar ni filtrar en el cliente. Los datos solo
 * viven en memoria mientras la pantalla está abierta.
 */
@Component({
  selector: 'app-health-history-page',
  imports: [
    AsyncState,
    DatePipe,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    ReactiveFormsModule,
    RouterLink,
    TranslatePipe,
  ],
  templateUrl: './health-history-page.html',
  styleUrls: [
    '../../training-page.scss',
    '../../history/history-page/history-page.scss',
    './health-history-page.scss',
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HealthHistoryPage {
  private readonly gateway = inject(HealthHistoryGateway);
  private readonly route = inject(ActivatedRoute);
  private readonly injector = inject(Injector);

  protected readonly scope: HealthScope = this.resolveScope();
  protected readonly typeOptions = HEALTH_TYPE_OPTIONS;
  protected readonly severityOptions = HEALTH_SEVERITY_OPTIONS;

  protected readonly form = new FormGroup({
    from: new FormControl('', { nonNullable: true }),
    to: new FormControl('', { nonNullable: true }),
    type: new FormControl<HealthReportType | null>(null),
    severity: new FormControl<HealthSeverity | null>(null),
  });

  /** Filtros de la consulta vigente (los del formulario al aplicarlos). */
  protected readonly applied = signal<HealthFilters>(NO_HEALTH_FILTERS);
  protected readonly state = signal<ViewState<LoadedReports>>(viewState.loading());
  protected readonly reports = signal<readonly HealthReport[]>([]);
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly loadingMore = signal(false);
  protected readonly moreError = signal<ApiError | null>(null);

  /** Error de la primera página con mensaje propio, o `null`. */
  protected readonly ownError = computed(() => {
    const state = this.state();
    if (state.status !== 'error' || state.error.code === null) {
      return null;
    }
    const key = OWN_MESSAGE_CODES[state.error.code];
    return key === undefined ? null : { key, correlationId: state.error.correlationId };
  });

  protected readonly emptyKey = computed(() =>
    hasHealthFilters(this.applied())
      ? 'training.health.empty.filtered'
      : `training.health.empty.${this.scope.kind}`,
  );

  protected readonly recoveryText = recoveryText;

  /** Evita que una respuesta de una consulta anterior pise la vigente. */
  private generation = 0;
  private readonly formDirective = viewChild.required(FormGroupDirective);
  private readonly table = viewChild<ElementRef<HTMLElement>>('table');

  constructor() {
    void this.loadFirst();
  }

  protected applyFilters(): void {
    const value = this.form.getRawValue();
    this.applied.set({
      from: value.from || null,
      to: value.to || null,
      type: value.type,
      severity: value.severity,
    });
    void this.loadFirst();
  }

  protected clearFilters(): void {
    this.formDirective().resetForm({ from: '', to: '', type: null, severity: null });
    this.applied.set(NO_HEALTH_FILTERS);
    void this.loadFirst();
  }

  /** Primera página con los filtros vigentes; también es el reintento. */
  protected async loadFirst(): Promise<void> {
    const generation = ++this.generation;
    this.state.set(viewState.loading());
    this.reports.set([]);
    this.nextCursor.set(null);
    this.moreError.set(null);
    // Una página siguiente en curso queda descartada: su `finally` ya no la libera.
    this.loadingMore.set(false);
    try {
      const page = await this.gateway.loadPage(this.scope, this.applied(), null);
      if (generation !== this.generation) {
        return;
      }
      this.reports.set(page.reports);
      this.nextCursor.set(page.nextCursor);
      this.state.set(
        viewState.fromData({ reports: page.reports }, (data) => data.reports.length === 0),
      );
    } catch (error) {
      if (generation === this.generation) {
        this.state.set(viewState.fromError(error));
      }
    }
  }

  /** Página siguiente con el cursor tal como lo entregó el backend (CA6). */
  protected async loadMore(): Promise<void> {
    const cursor = this.nextCursor();
    if (cursor === null || this.loadingMore()) {
      return;
    }
    const generation = this.generation;
    const firstNew = this.reports().length;
    this.loadingMore.set(true);
    this.moreError.set(null);
    try {
      const page = await this.gateway.loadPage(this.scope, this.applied(), cursor);
      if (generation !== this.generation) {
        return;
      }
      this.reports.update((reports) => [...reports, ...page.reports]);
      this.nextCursor.set(page.nextCursor);
      this.focusRow(firstNew);
    } catch (error) {
      if (generation === this.generation) {
        // Los reportes ya cargados se conservan; solo falla la página siguiente.
        this.moreError.set(toApiError(error));
      }
    } finally {
      if (generation === this.generation) {
        this.loadingMore.set(false);
      }
    }
  }

  private resolveScope(): HealthScope {
    const athleteId = this.route.snapshot.paramMap.get('athleteId');
    return athleteId === null ? { kind: 'own' } : { kind: 'athlete', athleteId };
  }

  /** Lleva el foco al primer reporte agregado para seguir leyendo con teclado. */
  private focusRow(index: number): void {
    afterNextRender(
      () =>
        this.table()
          ?.nativeElement.querySelectorAll<HTMLElement>('tbody tr')
          .item(index)
          ?.focus(),
      { injector: this.injector },
    );
  }
}
