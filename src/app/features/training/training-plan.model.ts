import { SPORTS, TrainingPlanResponseDto } from '../../core/api/bff-web/training.api';

/** Deporte de una sesión; catálogo del contrato (`PlannedSession.sport`). */
export type Sport = (typeof SPORTS)[number];
export const SPORT_OPTIONS: readonly Sport[] = SPORTS;

export interface PlannedSession {
  /** Fecha calendario `YYYY-MM-DD`, sin hora ni zona horaria. */
  readonly scheduledDate: string;
  readonly sport: Sport;
  readonly durationMinutes: number;
  /** Intensidad percibida RPE (escala CR10). */
  readonly intensityRpe: number;
}

/**
 * Plan de entrenamiento confirmado por el backend (HU010 CA1 y CA4). Solo lleva
 * identificadores del deportista y del creador: ningún dato de perfil.
 */
export interface TrainingPlan {
  readonly id: string;
  readonly athleteId: string;
  readonly professionalId: string;
  readonly title: string;
  readonly objectives: readonly string[];
  /** Periodo del plan: fechas calendario `YYYY-MM-DD`. */
  readonly startDate: string;
  readonly endDate: string;
  readonly status: 'ASSIGNED';
  readonly version: number;
  readonly sessions: readonly PlannedSession[];
  /** Instante ISO 8601 de creación. */
  readonly createdAt: string;
}

export function toTrainingPlan(dto: TrainingPlanResponseDto): TrainingPlan {
  return {
    id: dto.plan_id,
    athleteId: dto.athlete_id,
    professionalId: dto.professional_id,
    title: dto.title,
    objectives: [...dto.objectives],
    startDate: dto.start_date,
    endDate: dto.end_date,
    status: dto.status,
    version: dto.version,
    sessions: dto.sessions.map((session) => ({
      scheduledDate: session.scheduled_date,
      sport: session.sport,
      durationMinutes: session.duration_minutes,
      intensityRpe: session.intensity_rpe,
    })),
    createdAt: dto.created_at,
  };
}
