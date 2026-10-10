import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatToolbarModule } from '@angular/material/toolbar';
import { RouterOutlet } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'app-root',
  imports: [MatToolbarModule, RouterOutlet, TranslatePipe],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  /** Con `<base href>` un ancla `#id` navegaría a la raíz; se mueve el foco directamente. */
  protected skipToMain(event: Event, main: HTMLElement): void {
    event.preventDefault();
    main.focus();
  }
}
