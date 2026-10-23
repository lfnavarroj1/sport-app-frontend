import {
  CreateNutritionPlanOutcome,
  FoodCatalog,
  NutritionPlan,
  NutritionPlanDraft,
  NutritionPlansPage,
} from './nutrition-plan.model';

/**
 * Puerto hacia el BFF web para los planes de alimentación (HU014, ADR-037). Las
 * pantallas dependen solo de esta abstracción; `HttpNutritionGateway` traduce el
 * contrato bff-web 0.18.0.
 */
export abstract class NutritionGateway {
  /** Catálogo cerrado de alimentos. Rechaza con el error original si falla. */
  abstract loadCatalog(): Promise<FoodCatalog>;

  /**
   * @param idempotencyKey igual en los reintentos del mismo intento lógico.
   * Resuelve siempre con un `CreateNutritionPlanOutcome`; los fallos técnicos se
   * expresan como `{ kind: 'failed' }`, nunca como éxito.
   */
  abstract createPlan(
    draft: NutritionPlanDraft,
    idempotencyKey: string,
  ): Promise<CreateNutritionPlanOutcome>;

  /** Rechaza con el error original si el plan no se puede consultar. */
  abstract getPlan(planId: string): Promise<NutritionPlan>;

  /**
   * Página de planes del deportista autenticado. `cursor` es el `nextCursor` de
   * la página anterior, sin modificar; `null` para la primera. Rechaza con el
   * error original: un fallo nunca se interpreta como lista vacía.
   */
  abstract loadMyPlans(cursor: string | null): Promise<NutritionPlansPage>;
}
