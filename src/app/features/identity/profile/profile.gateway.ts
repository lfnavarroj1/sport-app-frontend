import {
  AthleteProfile,
  DemographicDraft,
  DemographicProfile,
  NutritionHabits,
  NutritionHabitsDraft,
  PhysiologicalDraft,
  PhysiologicalProfile,
  SaveOutcome,
  SportHabits,
  SportHabitsDraft,
  SportHabitsUpdate,
} from './profile.model';

/**
 * Puerto hacia el BFF web para el perfil del deportista (HU005, HU006, HU008 y
 * HU009). `HttpProfileGateway` traduce el contrato bff-web 0.30.0.
 */
export abstract class ProfileGateway {
  /**
   * Perfil proyectado. Rechaza con el error original si la consulta falla:
   * nunca se interpreta como un perfil vacío.
   */
  abstract loadProfile(): Promise<AthleteProfile>;

  /**
   * Registra o reemplaza la sección demográfica.
   *
   * @param expectedVersion `null` al crear; la última versión conocida al reemplazar.
   * @param idempotencyKey igual en todos los intentos del mismo intento lógico.
   * @param onRetry se invoca antes de cada reintento automático (1, 2 o 3).
   * Resuelve siempre con un `SaveOutcome`; los fallos nunca se expresan como éxito.
   */
  abstract saveDemographic(
    draft: DemographicDraft,
    expectedVersion: number | null,
    idempotencyKey: string,
    onRetry?: (attempt: number) => void,
  ): Promise<SaveOutcome<DemographicProfile>>;

  /** Registra o reemplaza la sección fisiológica; mismas reglas que la demográfica. */
  abstract savePhysiological(
    draft: PhysiologicalDraft,
    expectedVersion: number | null,
    idempotencyKey: string,
    onRetry?: (attempt: number) => void,
  ): Promise<SaveOutcome<PhysiologicalProfile>>;

  /** Registra o reemplaza los hábitos deportivos (HU006); mismas reglas que las secciones de HU005. */
  abstract saveSportHabits(
    draft: SportHabitsDraft,
    expectedVersion: number | null,
    idempotencyKey: string,
    onRetry?: (attempt: number) => void,
  ): Promise<SaveOutcome<SportHabits>>;

  /**
   * Actualiza parcialmente los hábitos deportivos vigentes (HU008): solo envía
   * `update.sections`; el backend conserva las demás. Mismas reglas de clave,
   * reintentos y resultados que el reemplazo; `404 sport_habits_not_found` es un
   * fallo con su código.
   *
   * @param expectedVersion la última versión conocida (obligatoria).
   */
  abstract updateSportHabits(
    update: SportHabitsUpdate,
    expectedVersion: number,
    idempotencyKey: string,
    onRetry?: (attempt: number) => void,
  ): Promise<SaveOutcome<SportHabits>>;

  /**
   * Registra o reemplaza los hábitos alimenticios (HU009), con el consentimiento
   * de datos de salud; mismas reglas que las secciones de HU005.
   */
  abstract saveNutritionHabits(
    draft: NutritionHabitsDraft,
    expectedVersion: number | null,
    idempotencyKey: string,
    onRetry?: (attempt: number) => void,
  ): Promise<SaveOutcome<NutritionHabits>>;
}
