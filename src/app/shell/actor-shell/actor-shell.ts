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

import { SessionAccessStore } from '../../core/session/session-access.store';
import { LOGIN_PATH } from '../../core/session/session.guards';
import { ActorType, SessionStore } from '../../core/session/session.store';
import { AsyncState } from '../../shared/ui/async-state/async-state';
import {
  NAVIGATION,
  UNAUTHORIZED_PATH,
  navigationSections,
} from '../navigation/navigation.registry';

/** Ancho a partir del cual el menú lateral queda fijo. */
const WIDE_LAYOUT = '(min-width: 960px)';

/**
 * Área autenticada de un actor (ADR-025): menú lateral izquierdo con las opciones
 * de su rol y el contenido de la ruta hija. El actor sale de los datos de la ruta;
 * la guarda `requireActor` ya comprobó que coincide con la sesión. Las opciones
 * que exigen un permiso o una capacidad aparecen solo cuando
 * `GET /v1/me/capabilities` las confirma (ADR-024).
 */
@Component({
  selector: 'app-actor-shell',
  imports: [
    AsyncState,
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
  private readonly access = inject(SessionAccessStore);

  protected readonly actor = inject(ActivatedRoute).snapshot.data['actor'] as ActorType;
  protected readonly planCapabilities = NAVIGATION[this.actor].planCapabilities;
  protected readonly accessState = this.access.view;
  protected readonly sections = computed(() => {
    const state = this.accessState();
    return navigationSections(this.actor, state?.status === 'success' ? state.data : null);
  });
  protected readonly provisioning = computed(() => {
    const state = this.accessState();
    return state?.status === 'success' && state.data.subscriptionStatus === 'PROVISIONING';
  });

  protected readonly wide = toSignal(
    inject(BreakpointObserver)
      .observe(WIDE_LAYOUT)
      .pipe(map((state) => state.matches)),
    { initialValue: true },
  );
  protected readonly mode = computed(() => (this.wide() ? 'side' : 'over'));

  constructor() {
    const router = inject(Router);
    this.access.ensureLoaded();
    // Si la sesión termina se sale del área: al acceso, o al acceso no autorizado
    // cuando el BFF no admite el tipo de actor (CA10).
    effect(() => {
      if (this.session.user() === null) {
        const unauthorized = this.session.lastEndReason() === 'unauthorized_actor';
        void router.navigateByUrl(unauthorized ? UNAUTHORIZED_PATH : LOGIN_PATH);
      }
    });
  }

  protected retry(): void {
    this.access.reload();
  }
}
