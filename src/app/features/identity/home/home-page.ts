import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { LOGIN_PATH } from '../../../core/session/session.guards';
import { SessionStore } from '../../../core/session/session.store';

/**
 * Inicio común tras iniciar sesión (HU003, decisión 2026-10-10): saluda al usuario
 * y muestra su tipo de cuenta mientras no existan áreas por rol.
 */
@Component({
  selector: 'app-home-page',
  imports: [MatCardModule, TranslatePipe],
  template: `
    @if (user(); as user) {
      <mat-card appearance="outlined" class="home">
        <mat-card-content>
          <h1>{{ 'home.greeting' | translate: { name: user.fullName } }}</h1>
          <dl>
            <dt>{{ 'home.accountType' | translate }}</dt>
            <dd data-testid="home-actor-type">
              {{ 'registration.actorTypes.' + user.actorType | translate }}
            </dd>
            <dt>{{ 'home.email' | translate }}</dt>
            <dd data-testid="home-email">{{ user.email }}</dd>
          </dl>
        </mat-card-content>
      </mat-card>
    }
  `,
  styles: `
    .home {
      max-width: 32rem;
      margin: 2rem auto;
    }

    h1 {
      margin: 0 0 1rem;
      font: var(--mat-sys-headline-small);
    }

    dt {
      font: var(--mat-sys-label-large);
    }

    dd {
      margin: 0 0 0.75rem;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomePage {
  protected readonly user = inject(SessionStore).user;

  constructor() {
    const router = inject(Router);
    // Si la sesión termina (p. ej. vence el access token) se vuelve al acceso.
    effect(() => {
      if (this.user() === null) {
        void router.navigateByUrl(LOGIN_PATH);
      }
    });
  }
}
