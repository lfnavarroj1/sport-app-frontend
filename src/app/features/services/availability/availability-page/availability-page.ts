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
  viewChild,
} from '@angular/core';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  FormGroupDirective,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { ApiError, toApiError } from '../../../../core/api/api-error';
import {
  SERVICE_CATEGORIES,
  SERVICE_MODALITIES,
} from '../../../../core/api/bff-web/services-availability.api';
import { FieldError } from '../../../../shared/forms/field-error/field-error';
import { AsyncState } from '../../../../shared/ui/async-state/async-state';
import { ViewState, viewState } from '../../../../shared/ui/view-state';
import { AssociationAction } from '../../associations/association-action/association-action';
import { MyAssociations } from '../../associations/my-associations/my-associations';
import { browserTimeZone, formatIntervalRange, formatPrice } from '../availability-format';
import { AvailabilityGateway } from '../availability.gateway';
import {
  AvailabilityFilters,
  CatalogEntry,
  MAX_PERIOD_DAYS,
  ServiceCategory,
  ServiceModality,
  addDays,
  periodDays,
} from '../availability.model';

/** Primera página cargada: base de la vista. */
interface LoadedCatalog {
  readonly services: readonly CatalogEntry[];
}

/** Días que abarca el periodo por defecto: hoy y los seis siguientes. */
const DEFAULT_PERIOD_DAYS = 7;

/**
 * Validación de experiencia del periodo: la fecha final no es anterior a la
 * inicial y el periodo no supera el máximo del contrato. El BFF sigue siendo la
 * autoridad (`422 validation_error`).
 */
function periodValidator(group: AbstractControl): ValidationErrors | null {
  const { fromDate, toDate } = group.value as { fromDate: string; toDate: string };
  if (!fromDate || !toDate) {
    return null;
  }
  const days = periodDays(fromDate, toDate);
  if (days < 1) {
    return { toBeforeFrom: true };
  }
  if (days > MAX_PERIOD_DAYS) {
    return { periodTooLong: { max: MAX_PERIOD_DAYS } };
  }
  return null;
}

/**
 * Disponibilidad de servicios (HU020): el deportista consulta los servicios
 * publicados y sus intervalos disponibles en un periodo de hasta 31 días, con
 * filtros por categoría y modalidad, en el orden estable del backend y con
 * paginación por cursor («Cargar más»).
 *
 * Solo lectura: consultar no reserva (CA5) y la tarifa es informativa (CA6).
 * Qué categorías ve el deportista lo decide el backend según su plan: la web
 * solo informa `restricted_categories` (CA1). Los instantes se muestran en la
 * zona del navegador y se deja visible la zona del servicio (CA3).
 *
 * En la opción Premium (`presetCategory = SPORTS_MEDICINE`) agrega HU017: la lista
 * «Mis servicios asociados» y, en cada servicio médico, «Asociar» o «Quitar».
 */
@Component({
  selector: 'app-availability-page',
  imports: [
    AssociationAction,
    AsyncState,
    FieldError,
    MatButtonModule,
    MatCardModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MyAssociations,
    ReactiveFormsModule,
    TranslatePipe,
  ],
  templateUrl: './availability-page.html',
  styleUrl: './availability-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AvailabilityPage {
  private readonly gateway = inject(AvailabilityGateway);
  private readonly route = inject(ActivatedRoute);
  private readonly injector = inject(Injector);
  private readonly locale = inject(LOCALE_ID);

  /** Categoría fijada por la ruta (`SPORTS_MEDICINE` en la opción Premium, ADR-038). */
  protected readonly presetCategory =
    (this.route.snapshot.data?.['presetCategory'] as ServiceCategory | undefined) ?? null;
  protected readonly titleKey = this.presetCategory
    ? 'services.availability.titleMedical'
    : 'services.availability.title';
  /**
   * La opción Premium reúne aquí la asociación de HU017: «Mis servicios asociados»
   * y las acciones «Asociar»/«Quitar» de los servicios médicos (ADR-038).
   */
  protected readonly associations = this.presetCategory === 'SPORTS_MEDICINE';

  protected readonly categoryOptions = SERVICE_CATEGORIES;
  protected readonly modalityOptions = SERVICE_MODALITIES;
  protected readonly maxDays = MAX_PERIOD_DAYS;
  protected readonly browserZone = browserTimeZone();

  protected readonly form = new FormGroup(
    {
      fromDate: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
      toDate: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
      categories: new FormControl<ServiceCategory[]>([], { nonNullable: true }),
      modalities: new FormControl<ServiceModality[]>([], { nonNullable: true }),
      includeUnavailable: new FormControl(false, { nonNullable: true }),
    },
    { validators: [periodValidator] },
  );

  /** Filtros de la consulta vigente (los del formulario al aplicarlos). */
  protected readonly applied = signal<AvailabilityFilters>(this.defaultFilters());
  protected readonly state = signal<ViewState<LoadedCatalog>>(viewState.loading());
  protected readonly services = signal<readonly CatalogEntry[]>([]);
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly loadingMore = signal(false);
  protected readonly moreError = signal<ApiError | null>(null);
  /** Categorías que el backend omitió por el plan del deportista (CA1). */
  protected readonly restrictedCategories = signal<readonly ServiceCategory[]>([]);

  protected readonly medicalRestricted = computed(() =>
    this.restrictedCategories().includes('SPORTS_MEDICINE'),
  );

  /** Evita que una respuesta de una consulta anterior pise la vigente. */
  private generation = 0;
  private readonly formDirective = viewChild.required(FormGroupDirective);
  private readonly list = viewChild<ElementRef<HTMLElement>>('list');

  constructor() {
    this.form.setValue(this.toFormValue(this.applied()));
    void this.loadFirst();
  }

  /** Error del periodo para mostrarlo cuando el deportista ya tocó las fechas. */
  protected periodError(): { key: string; params: Record<string, unknown> } | null {
    const errors = this.form.errors;
    const { fromDate, toDate } = this.form.controls;
    if (!errors || !(fromDate.touched || fromDate.dirty || toDate.touched || toDate.dirty)) {
      return null;
    }
    if (errors['toBeforeFrom']) {
      return { key: 'services.availability.filters.toBeforeFrom', params: {} };
    }
    if (errors['periodTooLong']) {
      return { key: 'services.availability.filters.periodTooLong', params: { max: this.maxDays } };
    }
    return null;
  }

  protected applyFilters(): void {
    if (this.form.invalid) {
      // Un formulario inválido no consulta: el deportista ve el motivo.
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.getRawValue();
    this.applied.set({
      fromDate: value.fromDate,
      toDate: value.toDate,
      categories: [...value.categories],
      modalities: [...value.modalities],
      includeUnavailable: value.includeUnavailable,
    });
    void this.loadFirst();
  }

  /** Vuelve a los valores por defecto, conservando la categoría de la ruta. */
  protected clearFilters(): void {
    const defaults = this.defaultFilters();
    this.formDirective().resetForm(this.toFormValue(defaults));
    this.applied.set(defaults);
    void this.loadFirst();
  }

  /** Primera página con los filtros vigentes; también es el reintento. */
  protected async loadFirst(): Promise<void> {
    const generation = ++this.generation;
    this.state.set(viewState.loading());
    this.services.set([]);
    this.nextCursor.set(null);
    this.moreError.set(null);
    this.loadingMore.set(false);
    this.restrictedCategories.set([]);
    try {
      const page = await this.gateway.loadPage(this.applied(), null);
      if (generation !== this.generation) {
        return;
      }
      this.restrictedCategories.set(page.restrictedCategories);
      this.services.set(page.services);
      this.nextCursor.set(page.nextCursor);
      this.state.set(
        viewState.fromData({ services: page.services }, (data) => data.services.length === 0),
      );
    } catch (error) {
      if (generation === this.generation) {
        // Ningún error se presenta como catálogo vacío.
        this.state.set(viewState.fromError(error));
      }
    }
  }

  /** Página siguiente con el cursor tal como lo entregó el backend (CA4). */
  protected async loadMore(): Promise<void> {
    const cursor = this.nextCursor();
    if (cursor === null || this.loadingMore()) {
      return;
    }
    const generation = this.generation;
    const firstNew = this.services().length;
    this.loadingMore.set(true);
    this.moreError.set(null);
    try {
      const page = await this.gateway.loadPage(this.applied(), cursor);
      if (generation !== this.generation) {
        return;
      }
      this.restrictedCategories.set(page.restrictedCategories);
      this.services.update((services) => [...services, ...page.services]);
      this.nextCursor.set(page.nextCursor);
      this.focusService(firstNew);
    } catch (error) {
      if (generation === this.generation) {
        // Los servicios ya cargados se conservan; solo falla la página siguiente.
        this.moreError.set(toApiError(error));
      }
    } finally {
      if (generation === this.generation) {
        this.loadingMore.set(false);
      }
    }
  }

  protected price(amount: string): string {
    return formatPrice(amount);
  }

  protected range(startsAt: string, endsAt: string): { start: string; end: string } {
    return formatIntervalRange(startsAt, endsAt, this.locale);
  }

  private defaultFilters(): AvailabilityFilters {
    const today = new Date();
    return {
      fromDate: addDays(today, 0),
      toDate: addDays(today, DEFAULT_PERIOD_DAYS - 1),
      categories: this.presetCategory ? [this.presetCategory] : [],
      modalities: [],
      includeUnavailable: false,
    };
  }

  private toFormValue(filters: AvailabilityFilters) {
    return {
      fromDate: filters.fromDate,
      toDate: filters.toDate,
      categories: [...filters.categories],
      modalities: [...filters.modalities],
      includeUnavailable: filters.includeUnavailable,
    };
  }

  /** Lleva el foco al primer servicio agregado para seguir leyendo con teclado. */
  private focusService(index: number): void {
    afterNextRender(
      () =>
        this.list()
          ?.nativeElement.querySelectorAll<HTMLElement>(':scope > li > h2')
          .item(index)
          ?.focus(),
      { injector: this.injector },
    );
  }
}
