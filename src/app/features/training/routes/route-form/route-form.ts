import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormArray,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { TranslatePipe } from '@ngx-translate/core';

import {
  ROUTE_COUNTRY_CODE_PATTERN,
  ROUTE_DIFFICULTIES,
  ROUTE_LIMITS,
  ROUTE_SPORTS,
} from '../../../../core/api/bff-web/routes.api';
import {
  RouteDifficulty,
  RouteDraft,
  RouteSport,
  RouteViolation,
  distanceIssue,
  normalizeDistance,
  routeFieldText,
  routeIssueKey,
  routeTarget,
} from '../routes.model';
import { RouteFieldError } from './route-field-error';

const LIMITS = ROUTE_LIMITS;

/** Texto recortado con longitud de contrato; vacío solo si es opcional. */
function trimmedLength(min: number, max: number, optional = false) {
  return (control: AbstractControl<string>): ValidationErrors | null => {
    const value = (control.value ?? '').trim();
    if (value === '') {
      return optional ? null : { required: true };
    }
    if (value.length < min) {
      return { minlength: { requiredLength: min, actualLength: value.length } };
    }
    return value.length > max
      ? { maxlength: { requiredLength: max, actualLength: value.length } }
      : null;
  };
}

/** Distancia con la forma del contrato: un decimal como máximo, de 0,1 a 500,0. */
function distance(control: AbstractControl<string>): ValidationErrors | null {
  const value = normalizeDistance(control.value ?? '');
  if (value === '') {
    return { required: true };
  }
  const issue = distanceIssue(value);
  return issue === 'format'
    ? { distanceFormat: true }
    : issue === 'range'
      ? { distanceRange: true }
      : null;
}

function coordinate(min: number, max: number) {
  return new FormControl<number | null>(null, {
    validators: [Validators.required, Validators.min(min), Validators.max(max)],
  });
}

function point() {
  return new FormGroup({
    lat: coordinate(LIMITS.latMin, LIMITS.latMax),
    lng: coordinate(LIMITS.lngMin, LIMITS.lngMax),
  });
}
type PointGroup = ReturnType<typeof point>;

/**
 * Formulario para publicar una ruta (HU026, ADR-041): nombre, descripción
 * opcional, deporte del catálogo de HU010, distancia como texto decimal (coma o
 * punto), dificultad, ciudad, país ISO alfa-2, punto de inicio y hasta 200 puntos
 * intermedios opcionales con latitud y longitud en rango. Sin mapa ni trazado
 * GPX. Solo se validan las restricciones del contrato; las reglas del servicio
 * llegan en `details` y se marcan en su campo o en su punto (CA2).
 */
@Component({
  selector: 'app-route-form',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    ReactiveFormsModule,
    RouteFieldError,
    TranslatePipe,
  ],
  templateUrl: './route-form.html',
  styleUrl: './route-form.scss',
})
export class RouteForm {
  readonly submitting = input(false);
  readonly serverErrors = input<readonly RouteViolation[] | null>(null);

  readonly submitted = output<RouteDraft>();
  /** El organizador modificó los datos. */
  readonly edited = output();
  readonly cancelled = output();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly limits = LIMITS;
  protected readonly sports = ROUTE_SPORTS;
  protected readonly difficulties = ROUTE_DIFFICULTIES;

  protected readonly form = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [trimmedLength(LIMITS.nameMin, LIMITS.nameMax)],
    }),
    description: new FormControl('', {
      nonNullable: true,
      validators: [trimmedLength(0, LIMITS.descriptionMax, true)],
    }),
    sport: new FormControl<RouteSport | null>(null, { validators: [Validators.required] }),
    distanceKm: new FormControl('', { nonNullable: true, validators: [distance] }),
    difficulty: new FormControl<RouteDifficulty | null>(null, {
      validators: [Validators.required],
    }),
    city: new FormControl('', {
      nonNullable: true,
      validators: [trimmedLength(LIMITS.cityMin, LIMITS.cityMax)],
    }),
    countryCode: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(ROUTE_COUNTRY_CODE_PATTERN)],
    }),
    startPoint: point(),
    waypoints: new FormArray<PointGroup>([]),
  });

  protected readonly waypoints = this.form.controls.waypoints;
  protected readonly waypointCount = signal(0);
  protected readonly canAddWaypoint = computed(() => this.waypointCount() < LIMITS.waypointsMax);

  /** Resumen de las reglas que informó el backend en el último envío. */
  protected readonly summary = computed(() =>
    (this.serverErrors() ?? []).map((violation) => ({
      field: routeFieldText(violation.field),
      issue: routeIssueKey(violation.issue),
    })),
  );

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

  protected addWaypoint(): void {
    if (!this.canAddWaypoint()) {
      return;
    }
    this.waypoints.push(point());
    this.waypointCount.set(this.waypoints.length);
    this.focusLast('[data-waypoint] input[formcontrolname="lat"]');
  }

  protected removeWaypoint(index: number): void {
    this.waypoints.removeAt(index);
    this.waypointCount.set(this.waypoints.length);
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
    const description = value.description.trim();
    this.submitted.emit({
      name: value.name.trim(),
      description: description === '' ? null : description,
      sport: value.sport as RouteSport,
      distanceKm: normalizeDistance(value.distanceKm),
      difficulty: value.difficulty as RouteDifficulty,
      city: value.city.trim(),
      countryCode: value.countryCode.trim(),
      startPoint: { lat: value.startPoint.lat as number, lng: value.startPoint.lng as number },
      waypoints: value.waypoints.map((item) => ({
        lat: item.lat as number,
        lng: item.lng as number,
      })),
    });
  }

  private applyServerErrors(violations: readonly RouteViolation[] | null): void {
    if (violations === null) {
      return;
    }
    for (const violation of violations) {
      const control = this.controlFor(violation.field);
      if (control !== null) {
        control.setErrors({ ...control.errors, routeRule: routeIssueKey(violation.issue) });
        control.markAsTouched();
        this.serverMarked.push(control);
      }
    }
    queueMicrotask(() =>
      this.host.nativeElement.querySelector<HTMLElement>('[data-testid="route-errors"]')?.focus(),
    );
  }

  private controlFor(field: string): AbstractControl | null {
    const target = routeTarget(field);
    switch (target.kind) {
      case 'field': {
        const { startPoint } = this.form.controls;
        if (target.control === 'startLat') {
          return startPoint.controls.lat;
        }
        if (target.control === 'startLng') {
          return startPoint.controls.lng;
        }
        return this.form.controls[target.control];
      }
      case 'waypoint': {
        const group = this.waypoints.at(target.index) as PointGroup | undefined;
        return group?.controls[target.coordinate ?? 'lat'] ?? null;
      }
      case 'waypoints':
      case 'none':
        return null;
    }
  }

  /** Al editar se retiran las marcas del backend; el resumen sigue hasta el siguiente envío. */
  private clearServerMarks(): void {
    const marked = this.serverMarked;
    this.serverMarked = [];
    for (const control of marked) {
      control.updateValueAndValidity({ emitEvent: false });
    }
  }

  private focusLast(selector: string): void {
    afterNextRender(
      () => {
        const elements = this.host.nativeElement.querySelectorAll<HTMLElement>(selector);
        elements.item(elements.length - 1)?.focus();
      },
      { injector: this.injector },
    );
  }

  private focusFirstInvalid(): void {
    queueMicrotask(() =>
      this.host.nativeElement
        .querySelector<HTMLElement>('input.ng-invalid, textarea.ng-invalid, mat-select.ng-invalid')
        ?.focus(),
    );
  }
}
