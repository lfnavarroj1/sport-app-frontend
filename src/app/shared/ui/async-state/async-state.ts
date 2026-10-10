import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslatePipe } from '@ngx-translate/core';

import { ApiErrorKind } from '../../../core/api/api-error';
import { ViewState } from '../view-state';

const NON_RETRYABLE: readonly ApiErrorKind[] = [
  'validation',
  'unauthenticated',
  'forbidden',
  'conflict',
  'not_configured',
];

/**
 * Representa de forma homogénea y accesible los estados de una vista remota.
 * El contenido proyectado solo se muestra en `success`.
 */
@Component({
  selector: 'app-async-state',
  imports: [MatButtonModule, MatProgressSpinnerModule, TranslatePipe],
  templateUrl: './async-state.html',
  styleUrl: './async-state.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AsyncState {
  readonly state = input.required<ViewState<unknown>>();
  readonly emptyMessageKey = input('common.state.empty');
  readonly retry = output();

  protected readonly error = computed(() => {
    const state = this.state();
    return state.status === 'error' ? state.error : null;
  });

  protected readonly retryable = computed(() => {
    const error = this.error();
    return error !== null && !NON_RETRYABLE.includes(error.kind);
  });
}
