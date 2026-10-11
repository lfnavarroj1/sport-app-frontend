import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { LOGIN_PATH } from '../../core/session/session.guards';
import { SessionStore } from '../../core/session/session.store';
import { homeFor } from '../navigation/navigation.registry';

/**
 * Acceso controlado (ADR-025, HU003 CA10): sin menú de negocio ni detalles del
 * recurso solicitado. Ofrece volver al inicio propio o al acceso.
 */
@Component({
  selector: 'app-unauthorized-page',
  imports: [MatButtonModule, MatCardModule, MatIconModule, RouterLink, TranslatePipe],
  template: `
    <mat-card appearance="outlined" class="unauthorized">
      <mat-card-content>
        <mat-icon class="unauthorized__icon" aria-hidden="true">block</mat-icon>
        <h1>{{ 'unauthorized.title' | translate }}</h1>
        <p>{{ 'unauthorized.message' | translate }}</p>
        <a mat-flat-button [routerLink]="destination().route">
          {{ destination().labelKey | translate }}
        </a>
      </mat-card-content>
    </mat-card>
  `,
  styles: `
    :host {
      display: block;
      padding: 0 1rem;
    }

    .unauthorized {
      max-width: 32rem;
      margin: 3rem auto;
      border: 0;
      border-radius: var(--sa-radius-lg);
      box-shadow: var(--sa-shadow-card);
      text-align: center;
    }

    .unauthorized__icon {
      width: 3rem;
      height: 3rem;
      margin-top: 1rem;
      color: var(--mat-sys-error);
      font-size: 3rem;
    }

    h1 {
      margin: 0.5rem 0;
      font: var(--mat-sys-headline-small);
      font-weight: 700;
    }

    p {
      margin: 0 0 1.5rem;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UnauthorizedPage {
  private readonly user = inject(SessionStore).user;

  protected readonly destination = computed(() => {
    const user = this.user();
    return user === null
      ? { route: LOGIN_PATH, labelKey: 'unauthorized.goToLogin' }
      : { route: homeFor(user.actorType), labelKey: 'unauthorized.goToHome' };
  });
}
