import { Component, input } from '@angular/core';
import { AbstractControl } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';

import { FieldError } from '../../../../shared/forms/field-error/field-error';

/**
 * Mensaje de un campo del perfil: primero la regla que informó el backend
 * (`profileRule`, con la clave i18n ya resuelta por `issueKey`), luego las
 * validaciones propias de HU005 (decimales, enteros, par de presión, fecha y
 * hora) y, por último, las de experiencia de `<app-field-error>`.
 */
@Component({
  selector: 'app-profile-field-error',
  imports: [FieldError, TranslatePipe],
  template: `
    @let errors = control().errors;
    @if (errors?.['profileRule']) {
      <span>{{ errors!['profileRule'] | translate }}</span>
    } @else if (errors?.['decimal']) {
      <span>{{ 'profile.validation.decimal' | translate }}</span>
    } @else if (errors?.['decimalRange']) {
      <span>{{ 'profile.validation.decimalRange' | translate: errors!['decimalRange'] }}</span>
    } @else if (errors?.['integer']) {
      <span>{{ 'profile.validation.integer' | translate }}</span>
    } @else if (errors?.['bloodPressurePair']) {
      <span>{{ 'profile.validation.bloodPressurePair' | translate }}</span>
    } @else if (errors?.['dateTime']) {
      <span>{{ 'profile.validation.dateTime' | translate }}</span>
    } @else {
      <app-field-error [control]="control()" />
    }
  `,
})
export class ProfileFieldError {
  readonly control = input.required<AbstractControl>();
}
