import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import {
  PRIVACY_NOTICE_REFERENCES,
  PRIVACY_NOTICE_SECTIONS,
  PRIVACY_NOTICE_VERSION,
  indexes,
} from '../privacy-notice.model';

/**
 * Contenido del aviso de tratamiento de datos (HU001), en lenguaje claro y con
 * los datos aprobados del proyecto. Lo usan la página pública y el formulario de
 * registro. Las secciones son `h2` (o `h3` dentro de otra sección) con su propio
 * identificador, y los enlaces externos se abren en una pestaña nueva de forma
 * segura y avisándolo a las tecnologías de asistencia.
 */
@Component({
  selector: 'app-privacy-notice',
  imports: [TranslatePipe],
  templateUrl: './privacy-notice.html',
  styleUrl: './privacy-notice.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PrivacyNotice {
  /** Nivel de los títulos de sección: 2 en la página, 3 dentro del formulario. */
  readonly headingLevel = input<2 | 3>(2);
  /** Prefijo de los `id` para que el contenido pueda aparecer dos veces sin chocar. */
  readonly idPrefix = input('aviso');

  protected readonly version = PRIVACY_NOTICE_VERSION;
  protected readonly sections = PRIVACY_NOTICE_SECTIONS;
  protected readonly references = PRIVACY_NOTICE_REFERENCES;
  protected readonly indexes = indexes;
}
