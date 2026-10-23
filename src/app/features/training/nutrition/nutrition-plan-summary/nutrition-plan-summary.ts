import { DatePipe, DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { FoodCatalog, NutritionPlanMeal, foodLabelKey } from '../nutrition-plan.model';

/** Contenido del plan que se presenta: borrador por confirmar o plan confirmado. */
export interface NutritionPlanSummaryData {
  readonly title: string;
  readonly objectives: readonly string[];
  readonly startDate: string;
  readonly endDate: string;
  readonly meals: readonly NutritionPlanMeal[];
}

/**
 * Resumen legible de un plan de alimentación (HU014): título, periodo, objetivos
 * y el menú diario con alimentos, cantidades y unidades. No calcula calorías ni
 * nutrientes ni emite juicios (ADR-037). Los nombres de los alimentos salen del
 * catálogo (`label_key`); si aún no está disponible se muestra el código.
 * Cada página proyecta sus datos adicionales (estado, versión…) en la lista de
 * datos del plan.
 */
@Component({
  selector: 'app-nutrition-plan-summary',
  imports: [DatePipe, DecimalPipe, NgTemplateOutlet, TranslatePipe],
  templateUrl: './nutrition-plan-summary.html',
  styleUrl: './nutrition-plan-summary.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NutritionPlanSummary {
  readonly plan = input.required<NutritionPlanSummaryData>();
  readonly catalog = input<FoodCatalog | null>(null);
  /** Nivel de los encabezados internos, según la página que lo contiene. */
  readonly headingLevel = input<2 | 3>(2);

  protected foodKey(code: string): string | null {
    return foodLabelKey(this.catalog(), code);
  }

  /** La cantidad confirmada es una cadena decimal; se formatea con la configuración regional. */
  protected amount(quantity: string): number {
    return Number(quantity);
  }
}
