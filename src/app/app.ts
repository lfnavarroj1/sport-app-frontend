import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatToolbarModule } from '@angular/material/toolbar';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { SessionStore } from './core/session/session.store';
import { homeFor } from './shell/navigation/navigation.registry';

@Component({
  selector: 'app-root',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatToolbarModule,
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    TranslatePipe,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly user = inject(SessionStore).user;
  /** Inicio propio del actor (ADR-025). */
  protected readonly homeRoute = computed(() => {
    const user = this.user();
    return user === null ? null : homeFor(user.actorType);
  });

  /** Con `<base href>` un ancla `#id` navegaría a la raíz; se mueve el foco directamente. */
  protected skipToMain(event: Event, main: HTMLElement): void {
    event.preventDefault();
    main.focus();
  }
}
