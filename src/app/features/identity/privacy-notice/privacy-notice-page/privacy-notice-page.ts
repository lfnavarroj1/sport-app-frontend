import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { PrivacyNotice } from '../privacy-notice/privacy-notice';

/**
 * Página pública del aviso de tratamiento de datos (HU001), en
 * `/aviso-de-privacidad`. No exige sesión: debe poder leerse antes de aceptar.
 * El formulario de registro la abre en una pestaña nueva para no perder los datos
 * capturados.
 */
@Component({
  selector: 'app-privacy-notice-page',
  imports: [MatButtonModule, MatCardModule, PrivacyNotice, RouterLink, TranslatePipe],
  template: `
    <article class="privacy-notice-page">
      <header class="privacy-notice-page__header">
        <h1>{{ 'privacyNotice.title' | translate }}</h1>
      </header>
      <mat-card appearance="outlined" class="privacy-notice-page__card">
        <mat-card-content>
          <app-privacy-notice [headingLevel]="2" idPrefix="aviso" />
        </mat-card-content>
      </mat-card>
      <nav
        class="privacy-notice-page__actions"
        [attr.aria-label]="'privacyNotice.actionsLabel' | translate"
      >
        <a mat-flat-button routerLink="/registro">{{
          'privacyNotice.goToRegistration' | translate
        }}</a>
        <a mat-button routerLink="/iniciar-sesion">{{ 'privacyNotice.goToLogin' | translate }}</a>
      </nav>
    </article>
  `,
  styles: `
    :host {
      display: block;
    }

    .privacy-notice-page {
      max-width: 52rem;
      margin: 0 auto;
      padding: 2rem clamp(1rem, 4vw, 3rem);
    }

    .privacy-notice-page__header h1 {
      margin: 0 0 1rem;
      font-size: clamp(1.5rem, 3vw, 2.25rem);
      font-weight: 800;
      line-height: 1.15;
    }

    .privacy-notice-page__card {
      border: 0;
      border-radius: var(--sa-radius-lg);
      box-shadow: var(--sa-shadow-card);
    }

    .privacy-notice-page__actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      margin-top: 1.5rem;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PrivacyNoticePage {}
