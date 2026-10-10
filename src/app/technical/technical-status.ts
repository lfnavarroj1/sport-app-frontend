import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { BffWebUrl } from '../core/api/bff-web-url';
import { APP_CONFIG } from '../core/config/app-config';
import { DiagnosticSession } from '../core/observability/diagnostic-session';

/**
 * Ruta técnica del andamiaje: comprueba arranque, configuración e i18n.
 * No representa ninguna historia de usuario ni llama al BFF.
 */
@Component({
  selector: 'app-technical-status',
  imports: [MatCardModule, TranslatePipe],
  templateUrl: './technical-status.html',
  styleUrl: './technical-status.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TechnicalStatus {
  protected readonly config = inject(APP_CONFIG);
  protected readonly bffConfigured = inject(BffWebUrl).isConfigured;
  protected readonly diagnosticId = inject(DiagnosticSession).id;
  protected readonly language = inject(TranslateService).getCurrentLang();
}
