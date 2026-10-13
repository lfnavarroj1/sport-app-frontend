import { Component, input } from '@angular/core';
import { AbstractControl } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';

import { FieldError } from '../../../../shared/forms/field-error/field-error';
import { ruleText } from '../plan-violations';

/**
 * Mensaje de un campo del editor: primero los rechazos del backend (regla de
 * coherencia incumplida o deportista sin autorización), luego las validaciones
 * de experiencia de `<app-field-error>`.
 */
@Component({
  selector: 'app-plan-field-error',
  imports: [FieldError, TranslatePipe],
  template: `
    @let errors = control().errors;
    @if (errors?.['athleteNotAuthorized']) {
      <span>{{ 'training.plan.errors.athleteNotAuthorized' | translate }}</span>
    } @else if (errors?.['planRule']) {
      <span>{{ rule(errors!['planRule']) | translate }}</span>
    } @else {
      <app-field-error [control]="control()" />
    }
  `,
})
export class PlanFieldError {
  readonly control = input.required<AbstractControl>();

  protected rule(issue: string): string {
    return ruleText(issue).key;
  }
}
