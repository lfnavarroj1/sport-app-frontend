import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';

import { SessionAccessStore } from '../../core/session/session-access.store';
import { SessionStore } from '../../core/session/session.store';
import { NAVIGATION, visibleItems } from '../navigation/navigation.registry';

/** Estado del plan del deportista que se informa en su inicio. */
export type PlanStatus = 'loading' | 'provisioning' | 'active' | 'unavailable';

/**
 * Inicio propio de cada actor (ADR-025, HU003 CA7–CA9): saludo, propósito del
 * área, estado del plan del deportista y funciones confirmadas por
 * `GET /v1/me/capabilities`. No presenta datos de negocio simulados: los
 * resúmenes (eventos, servicios, plan) llegan con las HU que los implementan.
 */
@Component({
  selector: 'app-actor-home-page',
  imports: [MatCardModule, MatIconModule, TranslatePipe],
  templateUrl: './actor-home-page.html',
  styleUrl: './actor-home-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActorHomePage {
  private readonly accessState = inject(SessionAccessStore).view;

  protected readonly user = inject(SessionStore).user;

  /** Funciones visibles del rol, sin «Inicio» ni las opciones de cuenta. */
  protected readonly features = computed(() => {
    const user = this.user();
    if (user === null) {
      return [];
    }
    const state = this.accessState();
    const access = state?.status === 'success' ? state.data : null;
    return visibleItems(user.actorType, access).filter(
      (item) => item.group !== 'main' && item.group !== 'account',
    );
  });

  /** Solo para el deportista; nunca se asume un plan sin la confirmación del BFF. */
  protected readonly planStatus = computed<PlanStatus | null>(() => {
    const user = this.user();
    if (user === null || !NAVIGATION[user.actorType].planCapabilities) {
      return null;
    }
    const state = this.accessState();
    if (state === null || state.status === 'loading') {
      return 'loading';
    }
    if (state.status !== 'success') {
      return 'unavailable';
    }
    return state.data.subscriptionStatus === 'ACTIVE' ? 'active' : 'provisioning';
  });
}
