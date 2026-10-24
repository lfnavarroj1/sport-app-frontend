import { ChangeOutcome, MyPlan, PlanChoice } from './my-plan.model';

/**
 * Puerto hacia el BFF web para «Mi plan» (HU016, ADR-036).
 * `HttpMyPlanGateway` traduce el contrato bff-web 0.20.0.
 */
export abstract class MyPlanGateway {
  /**
   * Catálogo de planes y suscripción vigente. Rechaza con el error original:
   * nunca se interpreta como plan gratuito ni como catálogo vacío.
   */
  abstract load(): Promise<MyPlan>;

  /**
   * Cambia el plan.
   *
   * @param idempotencyKey igual en todos los intentos del mismo intento lógico.
   * @param onRetry se invoca antes de cada reintento automático (1, 2 o 3).
   * Resuelve siempre con un `ChangeOutcome`; los fallos se expresan como
   * `{ kind: 'failed' }`, nunca como éxito.
   */
  abstract change(
    choice: PlanChoice,
    idempotencyKey: string,
    onRetry?: (attempt: number) => void,
  ): Promise<ChangeOutcome>;
}
