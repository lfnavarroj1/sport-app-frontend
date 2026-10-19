import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * Fondo de marca para las pantallas sin sesión (ingreso y registro): mensaje de
 * la plataforma y un panel donde se proyecta el formulario. Solo presentación.
 * Uso: `<app-auth-shell><mat-card>…</mat-card></app-auth-shell>`.
 */
@Component({
  selector: 'app-auth-shell',
  imports: [TranslatePipe],
  template: `
    <div class="auth-shell">
      <div class="auth-shell__intro">
        <p class="auth-shell__headline">{{ 'authShell.headline' | translate }}</p>
        <p class="auth-shell__tagline">{{ 'authShell.tagline' | translate }}</p>
      </div>
      <div class="auth-shell__panel">
        <ng-content />
      </div>
    </div>
  `,
  styleUrl: './auth-shell.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthShell {}
