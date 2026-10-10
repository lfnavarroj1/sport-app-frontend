import { Component, input } from '@angular/core';
import { AbstractControl } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';

interface FieldErrorMessage {
  readonly key: string;
  readonly params: Record<string, unknown>;
}

const KNOWN_ERRORS = ['required', 'email', 'minlength', 'maxlength', 'min', 'max', 'pattern'];

/**
 * Mensaje localizado del primer error de validación de experiencia de un
 * control. Las reglas autoritativas siguen en el backend.
 * Uso: `<mat-error><app-field-error [control]="form.controls.x" /></mat-error>`.
 */
@Component({
  selector: 'app-field-error',
  imports: [TranslatePipe],
  template: `
    @if (message(); as message) {
      <span>{{ message.key | translate: message.params }}</span>
    }
  `,
})
export class FieldError {
  readonly control = input.required<AbstractControl>();

  protected message(): FieldErrorMessage | null {
    const control = this.control();
    const errors = control.errors;
    if (!errors || !(control.touched || control.dirty)) {
      return null;
    }

    const [name, detail] = Object.entries(errors)[0];
    if (!KNOWN_ERRORS.includes(name)) {
      return { key: 'validation.invalid', params: {} };
    }
    const params = typeof detail === 'object' && detail !== null ? detail : {};
    return { key: `validation.${name}`, params };
  }
}
