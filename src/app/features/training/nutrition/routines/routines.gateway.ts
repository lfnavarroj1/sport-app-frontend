import { PublishOutcome, RetireOutcome, RoutineDraft, RoutinesPage } from './routines.model';

/**
 * Puerto hacia el BFF web para las rutinas de alimentación del profesional
 * (HU030, ADR-041). `HttpRoutinesGateway` traduce el contrato bff-web 0.34.0. El
 * catálogo de alimentos se consulta con `NutritionGateway` (HU014).
 */
export abstract class RoutinesGateway {
  /**
   * Página de rutinas propias (publicadas y retiradas). `cursor` es el
   * `nextCursor` anterior, sin modificar. Rechaza con el error original: nunca se
   * interpreta como lista vacía.
   */
  abstract loadRoutines(cursor: string | null): Promise<RoutinesPage>;

  /**
   * Publica una rutina.
   *
   * @param idempotencyKey igual en todos los intentos del mismo intento lógico.
   * @param onRetry se invoca antes de cada reintento automático (1, 2 o 3).
   * Resuelve siempre con un `PublishOutcome`; los fallos nunca se expresan como éxito.
   */
  abstract publish(
    draft: RoutineDraft,
    idempotencyKey: string,
    onRetry?: (attempt: number) => void,
  ): Promise<PublishOutcome>;

  /** Retira una rutina propia con la versión que muestra la pantalla. */
  abstract retire(routineId: string, expectedVersion: number): Promise<RetireOutcome>;
}
