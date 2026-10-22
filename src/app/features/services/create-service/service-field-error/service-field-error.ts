import { Component, input } from '@angular/core';
import { AbstractControl } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';

import { FieldError } from '../../../../shared/forms/field-error/field-error';
import { issueKey } from '../service-violations';

/**
 * Mensaje de un campo del servicio: primero la regla que informó el backend
 * (ADR-027), luego un importe o una zona que no cumplen el formato y, por
 * último, las validaciones de experiencia de `<app-field-error>`.
 */
@Component({
  selector: 'app-service-field-error',
  imports: [FieldError, TranslatePipe],
  template: `
    @let errors = control().errors;
    @if (errors?.['serviceRule']) {
      <span>{{ ruleKey(errors!['serviceRule']) | translate }}</span>
    } @else if (errors?.['amountFormat']) {
      <span>{{ 'services.create.validation.amountFormat' | translate }}</span>
    } @else if (errors?.['integer']) {
      <span>{{ 'services.create.validation.integer' | translate }}</span>
    } @else if (errors?.['timeZoneUnknown']) {
      <span>{{ 'services.create.issues.time_zone_unknown' | translate }}</span>
    } @else {
      <app-field-error [control]="control()" />
    }
  `,
})
export class ServiceFieldError {
  readonly control = input.required<AbstractControl>();

  protected ruleKey(issue: string): string {
    return issueKey(issue);
  }
}
