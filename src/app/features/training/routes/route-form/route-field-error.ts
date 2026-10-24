import { Component, input } from '@angular/core';
import { AbstractControl } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';

import { FieldError } from '../../../../shared/forms/field-error/field-error';

/**
 * Mensaje de un campo de la ruta: primero la regla que informó el backend
 * (`routeRule`, clave i18n ya resuelta), luego la forma de la distancia y, por
 * último, las validaciones de experiencia de `<app-field-error>`.
 */
@Component({
  selector: 'app-route-field-error',
  imports: [FieldError, TranslatePipe],
  template: `
    @let errors = control().errors;
    @if (errors?.['routeRule']) {
      <span>{{ errors!['routeRule'] | translate }}</span>
    } @else if (errors?.['distanceFormat']) {
      <span>{{ 'training.routes.validation.distanceFormat' | translate }}</span>
    } @else if (errors?.['distanceRange']) {
      <span>{{ 'training.routes.validation.distanceRange' | translate }}</span>
    } @else {
      <app-field-error [control]="control()" />
    }
  `,
})
export class RouteFieldError {
  readonly control = input.required<AbstractControl>();
}
