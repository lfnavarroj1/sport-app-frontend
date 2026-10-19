import { TrainingPlan } from '../training-plan.model';
import { CreatePlanOutcome, PlanDraft } from './plan-authoring.model';

/**
 * Puerto hacia el BFF web para la creación y consulta de planes (HU010). Las
 * pantallas dependen solo de esta abstracción; `HttpPlanAuthoringGateway`
 * traduce el contrato bff-web 0.12.0.
 */
export abstract class PlanAuthoringGateway {
  /**
   * @param idempotencyKey igual en los reintentos del mismo intento lógico (CA5).
   * Resuelve siempre con un `CreatePlanOutcome`; los fallos técnicos se expresan
   * como `{ kind: 'failed' }`, nunca como éxito.
   */
  abstract createPlan(draft: PlanDraft, idempotencyKey: string): Promise<CreatePlanOutcome>;

  /** Rechaza con el error original si el plan no se puede consultar (CA4). */
  abstract getPlan(planId: string): Promise<TrainingPlan>;
}
