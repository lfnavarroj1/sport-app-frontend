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
      <section class="home">
        <div class="home__hero">
          <h1>{{ 'home.greeting' | translate: { name: user.fullName } }}</h1>
          <p class="home__subtitle">{{ 'home.subtitle' | translate }}</p>
        </div>
        <mat-card appearance="outlined" class="home__card">
          <mat-card-content>
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
      </section>
    }
  `,
  styles: `
    :host {
      display: block;
    }

    .home__hero {
      position: relative;
      padding: 2.5rem 1rem 4.5rem;
      overflow: hidden;
      background:
        radial-gradient(circle at 90% 0%, rgb(242 107 29 / 45%), transparent 45%),
        linear-gradient(160deg, var(--sa-night) 0%, var(--sa-night-2) 100%);
      color: var(--sa-on-night);

      @media (min-width: 960px) {
        padding-inline: clamp(2rem, 6vw, 6rem);
      }
    }

    h1 {
      margin: 0 0 0.5rem;
      font-size: clamp(2rem, 4vw, 3rem);
      font-weight: 800;
      line-height: 1.1;
    }

    .home__subtitle {
      margin: 0;
      color: var(--sa-on-night-muted);
      font: var(--mat-sys-body-large);
    }

    .home__card {
      max-width: 40rem;
      margin: -2.5rem 1rem 2rem;
      border: 0;
      border-radius: var(--sa-radius-lg);
      box-shadow: var(--sa-shadow-card);

      @media (min-width: 960px) {
        margin-inline: clamp(2rem, 6vw, 6rem);
      }
    }

    dl {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: 0.75rem 1.5rem;
      margin: 0.5rem 0;
    }

    dt {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-large);
    }

    dd {
      margin: 0;
      overflow-wrap: anywhere;
      font: var(--mat-sys-body-large);
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
