import {
  AccountStatementResponseDto,
  CommitmentItemDto,
  CommitmentStatusDto,
  MovementItemDto,
  MovementTypeDto,
  StatementStatusDto,
} from '../../../core/api/bff-web/affiliation.api';
import { Periodicity, Subscription, toSubscription } from '../my-plan/my-plan.model';

/**
 * Modelo de pantalla del estado de cuenta (HU007, ADR-036). Transforma el
 * transporte de `GET /v1/me/account-statement` sin calcular nada del dominio: el
 * estado, los compromisos y los movimientos son los que publica el BFF. SportApp no
 * registra pagos, así que no existe saldo ni estado «pagado».
 */

export type StatementStatus = StatementStatusDto;
export type CommitmentStatus = CommitmentStatusDto;
export type MovementType = MovementTypeDto;

/** Fragmento de `/deportista/perfil` con el estado de cuenta, al que enlaza «Mi plan». */
export const ACCOUNT_STATEMENT_FRAGMENT = 'estado-de-cuenta';

/** Tamaño de página de movimientos que pide la web (el contrato admite 1 a 100). */
export const STATEMENT_PAGE_SIZE = 20;

/** Compromiso de pago informativo: SportApp no lo cobra ni lo marca pagado. */
export interface Commitment {
  readonly id: string;
  readonly planCode: string;
  readonly periodicity: Periodicity;
  /** Cadena decimal del contrato, en COP antes de impuestos. */
  readonly amount: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly dueAt: string;
  readonly status: CommitmentStatus;
}

export interface Movement {
  readonly id: string;
  readonly type: MovementType;
  readonly occurredAt: string;
  readonly planCode: string;
  readonly periodicity: Periodicity;
  /** Importe del compromiso en COP; `null` en los movimientos sin importe. */
  readonly amount: string | null;
}

export interface AccountStatement {
  readonly status: StatementStatus;
  /** La suscripción vigente; `null` sin suscripción activa. */
  readonly subscription: Subscription | null;
  readonly commitments: readonly Commitment[];
  readonly movements: readonly Movement[];
  /** Cursor opaco de la página siguiente de movimientos; `null` si no hay más. */
  readonly nextCursor: string | null;
}

/** Página de movimientos de una consulta posterior a la primera. */
export interface MovementsPage {
  readonly movements: readonly Movement[];
  readonly nextCursor: string | null;
}

export function toAccountStatement(response: AccountStatementResponseDto): AccountStatement {
  return {
    status: response.statement_status,
    subscription: response.subscription === null ? null : toSubscription(response.subscription),
    commitments: response.commitments.map(toCommitment),
    movements: response.movements.map(toMovement),
    nextCursor: response.next_cursor,
  };
}

function toCommitment(item: CommitmentItemDto): Commitment {
  return {
    id: item.commitment_id,
    planCode: item.plan_code,
    periodicity: item.periodicity,
    amount: item.amount,
    periodStart: item.period_start,
    periodEnd: item.period_end,
    dueAt: item.due_at,
    status: item.status,
  };
}

function toMovement(item: MovementItemDto): Movement {
  return {
    id: item.movement_id,
    type: item.movement_type,
    occurredAt: item.occurred_at,
    planCode: item.plan_code,
    periodicity: item.periodicity,
    amount: item.amount,
  };
}

/**
 * Agrega la página siguiente en el orden recibido; el BFF garantiza el orden y la
 * ausencia de repeticiones (CA5), así que la web no reordena ni filtra.
 */
export function appendMovements(
  statement: AccountStatement,
  page: MovementsPage,
): AccountStatement {
  return {
    ...statement,
    movements: [...statement.movements, ...page.movements],
    nextCursor: page.nextCursor,
  };
}

/** Planes del catálogo con nombre en `affiliation.statement.plans.*` (ADR-024). */
const KNOWN_PLANS: readonly string[] = ['FREE', 'INTERMEDIATE', 'PREMIUM'];

/**
 * Clave i18n del nombre de un plan, o `null` si llega un código que la web aún no
 * conoce (se muestra el código, nunca se oculta).
 */
export function planNameKey(code: string): string | null {
  return KNOWN_PLANS.includes(code) ? `affiliation.statement.plans.${code}` : null;
}

/**
 * Instante del contrato (UTC con `Z`) en la zona del navegador, con la zona
 * visible (CA1: fecha y zona horaria claras).
 */
export function formatStatementInstant(iso: string, locale: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone,
  }).format(new Date(iso));
}

/** Zona IANA del navegador con la que se muestran las fechas. */
export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
