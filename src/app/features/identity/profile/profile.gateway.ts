import {
  AthleteProfile,
  DemographicDraft,
  DemographicProfile,
  PhysiologicalDraft,
  PhysiologicalProfile,
  SaveOutcome,
} from './profile.model';

/**
 * Puerto hacia el BFF web para el perfil del deportista (HU005).
 * `HttpProfileGateway` traduce el contrato bff-web 0.15.0.
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
}
