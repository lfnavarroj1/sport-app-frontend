/**
 * Deportista con autorización vigente para el profesional de la sesión (HU011,
 * CA5). Nombre y correo son datos personales que compone el BFF: solo se muestran,
 * no se guardan ni se registran.
 */
export interface AuthorizedAthlete {
  readonly id: string;
  readonly fullName: string;
  readonly email: string;
  /** Instante ISO 8601 en que el deportista otorgó la autorización. */
  readonly authorizedAt: string;
}

/** Una página, en el orden estable del backend (`authorized_at` y `athlete_id` desc). */
export interface AuthorizedAthletesPage {
  readonly athletes: readonly AuthorizedAthlete[];
  /** Cursor opaco de la página siguiente; `null` si no hay más. */
  readonly nextCursor: string | null;
}
