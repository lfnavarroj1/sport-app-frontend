import { Component, input } from '@angular/core';
import { AbstractControl } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';

import { FieldError } from '../../../../../shared/forms/field-error/field-error';

/**
 * Mensaje de un campo de la rutina: primero la regla que informó el backend
 * (`routineRule`, clave i18n ya resuelta), luego que sea entero y, por último,
 * las validaciones de experiencia de `<app-field-error>`.
 */
@Component({
  selector: 'app-routine-field-error',
  imports: [FieldError, TranslatePipe],
  template: `
    @let errors = control().errors;
    @if (errors?.['routineRule']) {
      <span>{{ errors!['routineRule'] | translate }}</span>
    } @else if (errors?.['integer']) {
      <span>{{ 'training.nutrition.routines.validation.integer' | translate }}</span>
    } @else {
      <app-field-error [control]="control()" />
    }
  `,
})
export class RoutineFieldError {
  readonly control = input.required<AbstractControl>();
}
