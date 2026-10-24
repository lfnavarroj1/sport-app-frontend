import { Component, input } from '@angular/core';
import { AbstractControl } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';

import { FieldError } from '../../../../shared/forms/field-error/field-error';

/**
 * Mensaje de un campo de la plantilla: primero la regla que informó el backend
 * (`templateRule`, clave i18n ya resuelta), luego que sea entero y, por último,
 * las validaciones de experiencia de `<app-field-error>`.
 */
@Component({
  selector: 'app-template-field-error',
  imports: [FieldError, TranslatePipe],
  template: `
    @let errors = control().errors;
    @if (errors?.['templateRule']) {
      <span>{{ errors!['templateRule'] | translate }}</span>
    } @else if (errors?.['integer']) {
      <span>{{ 'training.templates.validation.integer' | translate }}</span>
    } @else {
      <app-field-error [control]="control()" />
    }
  `,
})
export class TemplateFieldError {
  readonly control = input.required<AbstractControl>();
}
