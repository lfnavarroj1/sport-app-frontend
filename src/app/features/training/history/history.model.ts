import { Sport } from '../training-plan.model';

/** De quién es el historial que se consulta (HU011). */
export type HistoryScope =
  | { readonly kind: 'own' }
  /** Deportista que autorizó al profesional de la sesión (relación vigente, CA3). */
  | { readonly kind: 'athlete'; readonly athleteId: string };

/** Filtros del historial; `null` significa sin filtro. */
export interface HistoryFilters {
  /** Fecha de fin inclusiva `YYYY-MM-DD` (día UTC en que terminó la sesión). */
  readonly from: string | null;
  readonly to: string | null;
  readonly sport: Sport | null;
}

export const NO_FILTERS: HistoryFilters = { from: null, to: null, sport: null };

/** Sesión de entrenamiento terminada. Sin métricas de salud ni ubicación. */
export interface HistorySession {
  readonly id: string;
  /** Plan al que pertenece, si lo hay. */
  readonly planId: string | null;
  readonly sport: Sport;
  /** Instantes ISO 8601. */
  readonly startedAt: string;
  readonly endedAt: string;
  readonly durationSeconds: number;
}

/** Una página del historial, en el orden estable del backend (`ended_at` desc). */
export interface HistoryPage {
  readonly sessions: readonly HistorySession[];
  /** Cursor opaco de la página siguiente; `null` si no hay más. */
  readonly nextCursor: string | null;
  /** Deportes por los que se puede filtrar, según el backend (CA2). */
  readonly availableSports: readonly Sport[];
}

export interface DurationText {
  readonly key: string;
  readonly params: Readonly<Record<string, number>>;
}

/** Duración legible: segundos, minutos u horas y minutos (claves i18n). */
export function durationText(seconds: number): DurationText {
  if (seconds < 60) {
    return { key: 'training.history.duration.seconds', params: { s: seconds } };
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return { key: 'training.history.duration.minutes', params: { m: minutes } };
  }
  return {
    key: 'training.history.duration.hoursMinutes',
    params: { h: Math.floor(minutes / 60), m: minutes % 60 },
  };
}

export function hasFilters(filters: HistoryFilters): boolean {
  return filters.from !== null || filters.to !== null || filters.sport !== null;
}
