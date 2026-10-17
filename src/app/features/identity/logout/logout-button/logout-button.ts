import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { TranslatePipe } from '@ngx-translate/core';

import { ApiError } from '../../../../core/api/api-error';
import { SessionStore } from '../../../../core/session/session.store';
import { HttpLogoutGateway } from '../http-logout.gateway';
import { LogoutGateway } from '../logout.gateway';

/**
 * Acción «Cerrar sesión» del menú lateral (HU004), para los tres actores web.
 * Pide al BFF la revocación y, solo cuando el BFF confirma que borró la cookie
 * (`204`, o `503`/`504` con la revocación remota sin confirmar), termina la sesión
 * en memoria: el access token, la identidad y la vista de permisos se descartan y
 * el área autenticada vuelve al acceso (CA1). Sin conexión la cookie sigue en el
 * navegador, así que la sesión no se da por cerrada y se ofrece reintentar. El
 * botón queda deshabilitado mientras el cierre está en curso: un solo envío.
 */
@Component({
  selector: 'app-logout-button',
  imports: [MatIconModule, MatListModule, TranslatePipe],
  providers: [{ provide: LogoutGateway, useClass: HttpLogoutGateway }],
  template: `
    <button
      mat-list-item
      type="button"
      data-menu-item="logout"
      [disabled]="busy()"
      [attr.aria-busy]="busy()"
      [attr.aria-describedby]="failure() ? 'logout-error' : null"
      (click)="logout()"
    >
      <mat-icon matListItemIcon aria-hidden="true">logout</mat-icon>
      <span matListItemTitle>
        {{ (busy() ? 'shell.logout.inProgress' : 'shell.items.logout') | translate }}
      </span>
    </button>
    @if (failure(); as error) {
      <div id="logout-error" class="logout-error" role="alert" data-testid="logout-error">
        <p>
          {{
            (error.kind === 'offline'
              ? 'shell.logout.errors.offline'
              : 'shell.logout.errors.failed'
            ) | translate
          }}
        </p>
        @if (error.correlationId) {
          <p class="logout-error__reference">
            {{ 'common.errors.reference' | translate: { id: error.correlationId } }}
          </p>
        }
      </div>
    }
  `,
  styles: `
    .logout-error {
      margin: 0.25rem 1rem 0.75rem;
      padding: 0.75rem 1rem;
      border-radius: 0.75rem;
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
      font: var(--mat-sys-body-medium);

      p {
        margin: 0;
      }
    }

    .logout-error__reference {
      margin-top: 0.25rem !important;
      font: var(--mat-sys-body-small);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LogoutButton {
  private readonly gateway = inject(LogoutGateway);
  private readonly session = inject(SessionStore);

  protected readonly busy = signal(false);
  protected readonly failure = signal<ApiError | null>(null);

  protected async logout(): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    this.failure.set(null);
    const outcome = await this.gateway.logout();
    this.busy.set(false);

    switch (outcome.kind) {
      case 'revoked':
        this.session.end('logged_out');
        break;
      case 'unconfirmed':
        this.session.end('logged_out_unconfirmed');
        break;
      case 'failed':
        this.failure.set(outcome.error);
        break;
    }
  }
}
