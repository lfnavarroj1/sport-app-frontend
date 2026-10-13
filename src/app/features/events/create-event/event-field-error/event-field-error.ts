import { Component, input } from '@angular/core';
import { AbstractControl } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';

import { FieldError } from '../../../../shared/forms/field-error/field-error';
import { issueKey } from '../event-violations';

/**
 * Mensaje de un campo del evento: primero la regla que informó el backend
 * (ADR-028), luego una zona que el navegador no conoce y, por último, las
 * validaciones de experiencia de `<app-field-error>`.
 */
@Component({
  selector: 'app-event-field-error',
  imports: [FieldError, TranslatePipe],
  template: `
    @let errors = control().errors;
    @if (errors?.['eventRule']) {
      <span>{{ ruleKey(errors!['eventRule']) | translate }}</span>
    } @else if (errors?.['timeZoneUnknown']) {
      <span>{{ 'events.create.issues.time_zone_unknown' | translate }}</span>
    } @else {
      <app-field-error [control]="control()" />
    }
  `,
})
export class EventFieldError {
  readonly control = input.required<AbstractControl>();

  protected ruleKey(issue: string): string {
    return issueKey(issue);
  }
}
