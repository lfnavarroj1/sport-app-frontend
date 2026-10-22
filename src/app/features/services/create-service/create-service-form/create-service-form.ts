import {
  Component,
  DestroyRef,
  ElementRef,
  LOCALE_ID,
  computed,
  effect,
  inject,
  input,
  output,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormArray,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { TranslatePipe } from '@ngx-translate/core';

import {
  BILLING_UNITS,
  BillingUnitDto,
  SERVICE_CATEGORIES,
  SERVICE_MODALITIES,
  ServiceCategoryDto,
  ServiceModalityDto,
} from '../../../../core/api/bff-web/services-availability.api';
import {
  CREATE_SERVICE_LIMITS,
  SERVICE_AMOUNT_PATTERN,
  SERVICE_CURRENCY,
} from '../../../../core/api/bff-web/services.api';
import {
  browserTimeZone,
  isKnownTimeZone,
  timeZoneOptions,
} from '../../../events/create-event/event-time';
import { formatPrice } from '../../availability/availability-format';
import { ServiceDraft, ServiceViolation, normalizeAmount } from '../create-service.model';
import { ServiceFieldError } from '../service-field-error/service-field-error';
import {
  IntervalControl,
  ServiceControl,
  fieldLabel,
  issueKey,
  targetFor,
} from '../service-violations';

const LIMITS = CREATE_SERVICE_LIMITS;
/** Sugerencias de zona que se muestran como máximo mientras se escribe. */
const MAX_TIME_ZONE_SUGGESTIONS = 50;

/**
 * Longitud tras recortar los espacios exteriores, como la mide el backend
 * (ADR-027, decisión 8). Usa los mismos errores que `Validators.minLength`/`maxLength`.
 */
function trimmedLength(min: number, max: number): ValidatorFn {
  return (control: AbstractControl<string>): ValidationErrors | null => {
    const value = (control.value ?? '').trim();
    if (value === '') {
      return { required: true };
    }
    if (value.length < min) {
      return { minlength: { requiredLength: min, actualLength: value.length } };
    }
    if (value.length > max) {
      return { maxlength: { requiredLength: max, actualLength: value.length } };
    }
    return null;
  };
}

/** Cadena decimal del contrato (hasta 9 cifras y 2 decimales), con coma o punto. */
const amountFormat = (control: AbstractControl<string>): ValidationErrors | null => {
  const value = normalizeAmount(control.value ?? '');
  return value === '' || SERVICE_AMOUNT_PATTERN.test(value) ? null : { amountFormat: true };
};

const integer = (control: AbstractControl<number | null>): ValidationErrors | null =>
  control.value !== null && !Number.isInteger(control.value) ? { integer: true } : null;

const knownTimeZone = (control: AbstractControl<string>): ValidationErrors | null =>
  control.value && !isKnownTimeZone(control.value.trim()) ? { timeZoneUnknown: true } : null;

function text(min: number, max: number): FormControl<string> {
  return new FormControl('', { nonNullable: true, validators: [trimmedLength(min, max)] });
}

function required<T>(): FormControl<T | null> {
  return new FormControl<T | null>(null, { validators: [Validators.required] });
}

function requiredText(value = ''): FormControl<string> {
  return new FormControl(value, { nonNullable: true, validators: [Validators.required] });
}

type IntervalGroup = FormGroup<{
  startDate: FormControl<string>;
  startTime: FormControl<string>;
  endDate: FormControl<string>;
  endTime: FormControl<string>;
  timeZone: FormControl<string>;
  capacity: FormControl<number | null>;
}>;

/**
 * Formulario de HU015 con exactamente los campos de ADR-027. Categoría,
 * modalidad, moneda y unidad de cobro son controles cerrados; el importe se
 * captura como texto y viaja como cadena decimal. La disponibilidad inicial es
 * opcional: hasta 100 intervalos explícitos, cada uno con su zona IANA.
 *
 * Solo aplica las restricciones del contrato (obligatorios, longitudes tras
 * recortar, patrón del importe, catálogos, capacidad, máximo de intervalos) y
 * comprueba que el navegador conozca la zona para calcular el desfase. Futuro,
 * duración, horizonte, orden y superposición de los intervalos los decide el
 * backend y llegan como `serverErrors`, marcados en el campo (CA3, CA6).
 */
@Component({
  selector: 'app-create-service-form',
  imports: [
    MatAutocompleteModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    ReactiveFormsModule,
    ServiceFieldError,
    TranslatePipe,
  ],
  templateUrl: './create-service-form.html',
  styleUrl: './create-service-form.scss',
})
export class CreateServiceForm {
  readonly submitting = input(false);
  readonly serverErrors = input<readonly ServiceViolation[] | null>(null);

  readonly submitted = output<ServiceDraft>();
  /** El profesional modificó los datos. */
  readonly edited = output();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly locale = inject(LOCALE_ID);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly limits = LIMITS;
  protected readonly categories = SERVICE_CATEGORIES;
  protected readonly modalities = SERVICE_MODALITIES;
  protected readonly billingUnits = BILLING_UNITS;
  protected readonly currency = SERVICE_CURRENCY;

  protected readonly form = new FormGroup({
    name: text(LIMITS.nameMin, LIMITS.nameMax),
    description: text(LIMITS.descriptionMin, LIMITS.descriptionMax),
    category: required<ServiceCategoryDto>(),
    modality: required<ServiceModalityDto>(),
    amount: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, amountFormat],
    }),
    // Única moneda del MVP (ADR-027): control cerrado con una sola opción.
    currency: requiredText(SERVICE_CURRENCY),
    billingUnit: required<BillingUnitDto>(),
    availability: new FormArray<IntervalGroup>([]),
  });

  protected readonly intervals = this.form.controls.availability;

  private readonly amountValue = toSignal(this.form.controls.amount.valueChanges, {
    initialValue: '',
  });
  private readonly intervalValues = toSignal(this.intervals.valueChanges, {
    initialValue: this.intervals.value,
  });
  private readonly allTimeZones = timeZoneOptions();

  /** Cómo verá la tarifa el deportista (`es-CO`); el dato enviado sigue siendo la cadena. */
  protected readonly pricePreview = computed(() => {
    const amount = normalizeAmount(this.amountValue());
    if (!SERVICE_AMOUNT_PATTERN.test(amount)) {
      return null;
    }
    return { formatted: formatPrice(amount), free: /^0+(\.0+)?$/.test(amount) };
  });

  /** Se pueden agregar intervalos hasta el máximo del contrato. */
  protected readonly canAddInterval = computed(
    () => this.intervalValues().length < LIMITS.intervalsMax,
  );

  /** Resumen de las reglas que informó el backend en el último envío. */
  protected readonly summary = computed(() =>
    (this.serverErrors() ?? []).map((violation) => ({
      label: fieldLabel(violation),
      issue: issueKey(violation.issue),
    })),
  );

  /** Controles marcados con un rechazo del backend en el último envío. */
  private serverMarked: AbstractControl[] = [];

  constructor() {
    effect(() => this.applyServerErrors(this.serverErrors()));
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this.clearServerMarks();
      this.edited.emit();
    });
  }

  /** Zonas IANA que contienen lo escrito en el control de zona de un intervalo. */
  protected timeZoneSuggestions(value: string): readonly string[] {
    const query = value.trim().toLowerCase();
    return this.allTimeZones
      .filter((zone) => zone.toLowerCase().includes(query))
      .slice(0, MAX_TIME_ZONE_SUGGESTIONS);
  }

  protected addInterval(): void {
    if (!this.canAddInterval()) {
      return;
    }
    // La zona del intervalo anterior, o la del navegador, como valor inicial.
    const previous = this.intervals.at(this.intervals.length - 1);
    const zone = previous?.controls.timeZone.value || browserTimeZone();
    this.intervals.push(this.createInterval(zone));
    const index = this.intervals.length - 1;
    queueMicrotask(() =>
      this.host.nativeElement
        .querySelector<HTMLElement>(`[data-interval="${index}"] input`)
        ?.focus(),
    );
  }

  protected removeInterval(index: number): void {
    this.intervals.removeAt(index);
    queueMicrotask(() =>
      this.host.nativeElement.querySelector<HTMLElement>('[data-testid="interval-add"]')?.focus(),
    );
  }

  protected submit(): void {
    if (this.submitting()) {
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.focusFirstInvalid();
      return;
    }
    const value = this.form.getRawValue();
    this.submitted.emit({
      name: value.name.trim(),
      description: value.description.trim(),
      category: value.category as ServiceCategoryDto,
      modality: value.modality as ServiceModalityDto,
      amount: normalizeAmount(value.amount),
      billingUnit: value.billingUnit as BillingUnitDto,
      intervals: value.availability.map((interval) => ({
        startDate: interval.startDate,
        startTime: interval.startTime,
        endDate: interval.endDate,
        endTime: interval.endTime,
        timeZone: interval.timeZone.trim(),
        capacity: interval.capacity as number,
      })),
    });
  }

  private createInterval(timeZone: string): IntervalGroup {
    const group: IntervalGroup = new FormGroup({
      startDate: requiredText(),
      startTime: requiredText(),
      endDate: requiredText(),
      endTime: requiredText(),
      timeZone: new FormControl(timeZone, {
        nonNullable: true,
        validators: [Validators.required, knownTimeZone],
      }),
      capacity: new FormControl<number | null>(null, {
        validators: [
          Validators.required,
          integer,
          Validators.min(LIMITS.capacityMin),
          Validators.max(LIMITS.capacityMax),
        ],
      }),
    });
    // Comodidad: la fecha de fin parte de la de inicio; el profesional puede cambiarla.
    group.controls.startDate.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((date) => {
        if (group.controls.endDate.value === '') {
          group.controls.endDate.setValue(date);
        }
      });
    return group;
  }

  private applyServerErrors(violations: readonly ServiceViolation[] | null): void {
    if (violations === null) {
      return;
    }
    for (const violation of violations) {
      const target = targetFor(violation.field);
      if (target.kind === 'service') {
        for (const name of target.controls) {
          this.markServerError(this.serviceControl(name), violation.issue);
        }
      } else if (target.kind === 'interval' && target.index < this.intervals.length) {
        const group = this.intervals.at(target.index);
        for (const name of target.controls) {
          this.markServerError(this.intervalControl(group, name), violation.issue);
        }
      }
    }
    queueMicrotask(() => {
      const summary = this.host.nativeElement.querySelector<HTMLElement>(
        '[data-testid="service-errors"]',
      );
      if (summary) {
        summary.focus();
      } else {
        this.focusFirstInvalid();
      }
    });
  }

  private serviceControl(name: ServiceControl): AbstractControl {
    return this.form.controls[name];
  }

  private intervalControl(group: IntervalGroup, name: IntervalControl): AbstractControl {
    return group.controls[name];
  }

  private markServerError(control: AbstractControl, issue: string): void {
    control.setErrors({ ...control.errors, serviceRule: issue });
    control.markAsTouched();
    this.serverMarked.push(control);
  }

  /**
   * Las reglas relacionan campos (la zona decide el desfase; un intervalo se
   * superpone con otro): al editar cualquier dato se retiran las marcas del
   * backend. El resumen del último envío sigue visible hasta el siguiente.
   */
  private clearServerMarks(): void {
    const marked = this.serverMarked;
    this.serverMarked = [];
    for (const control of marked) {
      control.updateValueAndValidity({ emitEvent: false });
    }
  }

  private focusFirstInvalid(): void {
    queueMicrotask(() =>
      this.host.nativeElement
        .querySelector<HTMLElement>('input.ng-invalid, textarea.ng-invalid, mat-select.ng-invalid')
        ?.focus(),
    );
  }
}
