import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';

import { SessionStore } from '../../core/session/session.store';
import { NAVIGATION } from '../navigation/navigation.registry';

/**
 * Inicio propio de cada actor (ADR-025, HU003 CA7–CA9): saludo, propósito del
 * área y funciones de su rol. No presenta datos de negocio simulados: los
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
  protected readonly user = inject(SessionStore).user;

  /** Funciones del rol, sin «Inicio» ni las opciones de cuenta. */
  protected readonly features = computed(() => {
    const user = this.user();
    if (user === null) {
      return [];
    }
    return NAVIGATION[user.actorType].items.filter(
      (item) => item.group !== 'main' && item.group !== 'account',
    );
  });

  protected readonly planCapabilities = computed(() => {
    const user = this.user();
    return user !== null && NAVIGATION[user.actorType].planCapabilities;
  });
}
