import { Component, input } from '@angular/core';
import { AbstractControl } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';

import { FieldError } from '../../../../../shared/forms/field-error/field-error';
import { ruleText } from '../nutrition-violations';

/**
 * Mensaje de un campo del editor: primero los rechazos del backend (deportista
 * sin autorización o reglas incumplidas, por ejemplo el bloqueo por alergia de un
 * alimento) y luego las validaciones de experiencia de `<app-field-error>`. Un
 * mismo alimento puede tener varias causas: se muestran todas.
 */
@Component({
  selector: 'app-nutrition-field-error',
  imports: [FieldError, TranslatePipe],
  template: `
    @let errors = control().errors;
    @if (errors?.['athleteNotAuthorized']) {
      <span>{{ 'training.nutrition.errors.athleteNotAuthorized' | translate }}</span>
    } @else if (errors?.['nutritionRules']) {
      @for (issue of errors!['nutritionRules']; track $index) {
        <span class="nutrition-field-error__rule">{{ rule(issue) | translate }}</span>
      }
    } @else {
      <app-field-error [control]="control()" />
    }
  `,
  styles: `
    .nutrition-field-error__rule {
      display: block;
    }
  `,
})
export class NutritionFieldError {
  readonly control = input.required<AbstractControl>();

  protected rule(issue: string): string {
    return ruleText(issue).key;
  }
}
