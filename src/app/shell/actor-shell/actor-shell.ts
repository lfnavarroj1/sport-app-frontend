import { BreakpointObserver } from '@angular/cdk/layout';
import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatSidenavModule } from '@angular/material/sidenav';
import {
  ActivatedRoute,
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
} from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { map } from 'rxjs';

import { LOGIN_PATH } from '../../core/session/session.guards';
import { ActorType, SessionStore } from '../../core/session/session.store';
import { NAVIGATION, navigationSections } from '../navigation/navigation.registry';

/** Ancho a partir del cual el menú lateral queda fijo. */
const WIDE_LAYOUT = '(min-width: 960px)';

/**
 * Área autenticada de un actor (ADR-025): menú lateral izquierdo con las opciones
 * de su rol y el contenido de la ruta hija. El actor sale de los datos de la ruta;
 * la guarda `requireActor` ya comprobó que coincide con la sesión.
 */
@Component({
  selector: 'app-actor-shell',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatListModule,
    MatSidenavModule,
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    TranslatePipe,
  ],
  templateUrl: './actor-shell.html',
  styleUrl: './actor-shell.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActorShell {
  private readonly session = inject(SessionStore);

  protected readonly actor = inject(ActivatedRoute).snapshot.data['actor'] as ActorType;
  protected readonly sections = navigationSections(this.actor);
  protected readonly planCapabilities = NAVIGATION[this.actor].planCapabilities;

  protected readonly wide = toSignal(
    inject(BreakpointObserver)
      .observe(WIDE_LAYOUT)
      .pipe(map((state) => state.matches)),
    { initialValue: true },
  );
  protected readonly mode = computed(() => (this.wide() ? 'side' : 'over'));

  constructor() {
    const router = inject(Router);
    // Si la sesión termina (por ejemplo, vence el access token) se vuelve al acceso.
    effect(() => {
      if (this.session.user() === null) {
        void router.navigateByUrl(LOGIN_PATH);
      }
    });
  }
}
