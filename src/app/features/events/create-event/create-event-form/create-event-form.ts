import {
  Component,
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
import { MatInputModule } from '@angular/material/input';
import { TranslatePipe } from '@ngx-translate/core';

import { COUNTRY_CODE_PATTERN, CREATE_EVENT_LIMITS } from '../../../../core/api/bff-web/events.api';
import { EventDraft, EventViolation } from '../create-event.model';
import { EventFieldError } from '../event-field-error/event-field-error';
import { browserTimeZone, countryName, isKnownTimeZone, timeZoneOptions } from '../event-time';
import { EventControl, controlsFor, fieldKey, issueKey } from '../event-violations';

const LIMITS = CREATE_EVENT_LIMITS;
/** Sugerencias de zona que se muestran como máximo mientras se escribe. */
const MAX_TIME_ZONE_SUGGESTIONS = 50;

/**
 * Longitud tras recortar los espacios exteriores, como la mide el backend
 * (ADR-028). Usa los mismos errores que `Validators.minLength`/`maxLength`.
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

const integer = (control: AbstractControl<number | null>): ValidationErrors | null =>
  control.value !== null && !Number.isInteger(control.value) ? { integer: true } : null;

const knownTimeZone = (control: AbstractControl<string>): ValidationErrors | null =>
  control.value && !isKnownTimeZone(control.value.trim()) ? { timeZoneUnknown: true } : null;

function text(min: number, max: number): FormControl<string> {
  return new FormControl('', { nonNullable: true, validators: [trimmedLength(min, max)] });
}

function bounded(min: number, max: number): FormControl<number | null> {
  return new FormControl<number | null>(null, {
    validators: [Validators.required, integer, Validators.min(min), Validators.max(max)],
  });
}

/**
 * Formulario de HU021 con exactamente los campos de ADR-028. Solo aplica las
 * restricciones del contrato (obligatorios, longitudes tras recortar, patrón del
 * país, rangos y enteros) y comprueba que el navegador conozca la zona para
 * calcular el desfase. Fecha futura, país existente y coherencia de la zona los
 * decide el backend y llegan como `serverErrors` (CA3).
 */
@Component({
  selector: 'app-create-event-form',
  imports: [
    EventFieldError,
    MatAutocompleteModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule,
    TranslatePipe,
  ],
  templateUrl: './create-event-form.html',
  styleUrl: './create-event-form.scss',
})
export class CreateEventForm {
  readonly submitting = input(false);
  readonly serverErrors = input<readonly EventViolation[] | null>(null);

  readonly submitted = output<EventDraft>();
  /** El organizador modificó los datos. */
  readonly edited = output();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly locale = inject(LOCALE_ID);

  protected readonly limits = LIMITS;

  protected readonly form = new FormGroup({
    name: text(LIMITS.nameMin, LIMITS.nameMax),
    description: text(LIMITS.descriptionMin, LIMITS.descriptionMax),
    discipline: text(LIMITS.disciplineMin, LIMITS.disciplineMax),
    locationName: text(LIMITS.locationNameMin, LIMITS.locationNameMax),
    address: text(LIMITS.addressMin, LIMITS.addressMax),
    city: text(LIMITS.cityMin, LIMITS.cityMax),
    countryCode: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(COUNTRY_CODE_PATTERN)],
    }),
    startDate: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    startTime: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    timeZone: new FormControl(browserTimeZone(), {
      nonNullable: true,
      validators: [Validators.required, knownTimeZone],
    }),
    durationMinutes: bounded(LIMITS.durationMin, LIMITS.durationMax),
    capacity: bounded(LIMITS.capacityMin, LIMITS.capacityMax),
  });

  private readonly timeZoneValue = toSignal(this.form.controls.timeZone.valueChanges, {
    initialValue: this.form.controls.timeZone.value,
  });
  private readonly countryValue = toSignal(this.form.controls.countryCode.valueChanges, {
    initialValue: '',
  });
  private readonly allTimeZones = timeZoneOptions();

  protected readonly timeZoneSuggestions = computed(() => {
    const query = this.timeZoneValue().trim().toLowerCase();
    return this.allTimeZones
      .filter((zone) => zone.toLowerCase().includes(query))
      .slice(0, MAX_TIME_ZONE_SUGGESTIONS);
  });

  protected readonly countryLabel = computed(() => countryName(this.countryValue(), this.locale));

  /** Resumen de las reglas que informó el backend en el último envío. */
  protected readonly summary = computed(() =>
    (this.serverErrors() ?? []).map((violation) => ({
      field: fieldKey(violation),
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

  /** El país se escribe en mayúsculas, como lo exige el contrato. */
  protected uppercaseCountry(): void {
    const control = this.form.controls.countryCode;
    const upper = control.value.toUpperCase();
    if (upper !== control.value) {
      control.setValue(upper);
    }
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
      discipline: value.discipline.trim(),
      location: {
        name: value.locationName.trim(),
        address: value.address.trim(),
        city: value.city.trim(),
        countryCode: value.countryCode.trim(),
      },
      startDate: value.startDate,
      startTime: value.startTime,
      timeZone: value.timeZone.trim(),
      durationMinutes: value.durationMinutes as number,
      capacity: value.capacity as number,
    });
  }

  private applyServerErrors(violations: readonly EventViolation[] | null): void {
    if (violations === null) {
      return;
    }
    for (const violation of violations) {
      for (const name of controlsFor(violation.field)) {
        this.markServerError(name, violation.issue);
      }
    }
    queueMicrotask(() => {
      const summary = this.host.nativeElement.querySelector<HTMLElement>(
        '[data-testid="event-errors"]',
      );
      if (summary) {
        summary.focus();
      } else {
        this.focusFirstInvalid();
      }
    });
  }

  private markServerError(name: EventControl, issue: string): void {
    const control = this.form.controls[name];
    control.setErrors({ ...control.errors, eventRule: issue });
    control.markAsTouched();
    this.serverMarked.push(control);
  }

  /**
   * Las reglas relacionan campos (cambiar la zona puede resolver el desfase de
   * la fecha): al editar cualquier dato se retiran las marcas del backend. El
   * resumen del último envío sigue visible hasta el siguiente.
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
        .querySelector<HTMLElement>('input.ng-invalid, textarea.ng-invalid')
        ?.focus(),
    );
  }
}
