import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * Entrada del profesional al historial (HU011). El contrato bff-web 0.8.0 consulta
 * el historial por `athlete_id` pero no ofrece una lista de los deportistas que
 * autorizaron al profesional; por decisión del responsable (2026-10-13) se llega
 * desde el plan de HU010, que trae el `athlete_id`. La selección directa queda
 * pendiente de esa lista en el contrato.
 */
@Component({
  selector: 'app-professional-history-intro',
  imports: [MatButtonModule, MatCardModule, RouterLink, TranslatePipe],
  template: `
    <section class="training-page">
      <header class="training-page__header">
        <h1>{{ 'training.history.title.athlete' | translate }}</h1>
        <p>{{ 'training.history.professionalIntro.message' | translate }}</p>
      </header>
      <mat-card appearance="outlined" class="training-page__card">
        <mat-card-content>
          <p data-testid="history-professional-intro">
            {{ 'training.history.professionalIntro.howTo' | translate }}
          </p>
          <div class="training-page__actions">
            <a mat-flat-button routerLink="/profesional/entrenamientos/planes">
              {{ 'training.history.professionalIntro.goToPlans' | translate }}
            </a>
          </div>
        </mat-card-content>
      </mat-card>
    </section>
  `,
  styleUrl: '../../training-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfessionalHistoryIntro {}
