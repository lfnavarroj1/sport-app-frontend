import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { PlannedSession } from '../training-plan.model';

/** Contenido del plan que se presenta: borrador por confirmar o plan confirmado. */
export interface PlanSummaryData {
  readonly title: string;
  readonly objectives: readonly string[];
  readonly startDate: string;
  readonly endDate: string;
  readonly sessions: readonly PlannedSession[];
}

/**
 * Presenta objetivos, periodo y sesiones de un plan de entrenamiento (HU010).
 * Las fechas del plan son fechas calendario sin zona horaria: se formatean en UTC
 * para que la zona del navegador no las desplace un día. El contenido proyectado
 * se ubica después del periodo (estado, versión, deportista…).
 */
@Component({
  selector: 'app-plan-summary',
  imports: [DatePipe, NgTemplateOutlet, TranslatePipe],
  templateUrl: './plan-summary.html',
  styleUrl: './plan-summary.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlanSummary {
  readonly plan = input.required<PlanSummaryData>();
  /** Nivel del encabezado de las secciones, según la jerarquía de la página. */
  readonly headingLevel = input<2 | 3>(2);
}
