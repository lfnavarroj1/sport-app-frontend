import { ApiError } from '../../../../core/api/api-error';
import {
  ACCOUNT_ISSUES,
  ACCOUNT_VERSION_CONFLICT_FIELD,
  AccountReadResponseDto,
  AccountResponseDto,
  AccountUpdateRequestDto,
} from '../../../../core/api/bff-web/account.api';
import { ErrorDetailDto } from '../../../../core/api/bff-web/contract';

/**
 * Datos personales de la cuenta (HU002, ADR-035) tal como los muestra la
 * pantalla. Solo nombre y correo son editables; la versión controla la
 * concurrencia.
 */
export interface Account {
  readonly fullName: string;
  readonly email: string;
  readonly version: number;
}

/** Valores que el usuario envía al editar sus datos personales. */
export interface AccountDraft {
  readonly fullName: string;
  readonly email: string;
}

/** Regla incumplida que informó el backend (`details` de `422 validation_error`). */
export interface AccountViolation {
  /** Ruta del campo en la solicitud, sin el prefijo `body.`. */
  readonly field: string;
  readonly issue: string;
}

/** Resultado de un envío; los fallos nunca se expresan como éxito. */
export type AccountSaveOutcome =
  | { readonly kind: 'saved'; readonly account: Account; readonly replayed: boolean }
  | { readonly kind: 'invalid'; readonly violations: readonly AccountViolation[] }
  /** `409 email_already_registered`: el correo no está disponible (sin más detalle). */
  | { readonly kind: 'email_taken' }
  /** `409 version_conflict`, con la versión vigente si el BFF la informa. */
  | { readonly kind: 'conflict'; readonly currentVersion: number | null }
  | { readonly kind: 'failed'; readonly error: ApiError };

export const KNOWN_ACCOUNT_ISSUES: readonly string[] = ACCOUNT_ISSUES;

/** Cuenta proyectada (`GET`) o confirmada (`PUT`) → modelo de pantalla. */
export function toAccount(dto: AccountReadResponseDto | AccountResponseDto): Account {
  return { fullName: dto.full_name, email: dto.email, version: dto.version };
}

/** Solicitud del comando: siempre con la versión vigente que ve el usuario. */
export function toAccountRequest(
  draft: AccountDraft,
  expectedVersion: number,
): AccountUpdateRequestDto {
  return { expected_version: expectedVersion, full_name: draft.fullName, email: draft.email };
}

/**
 * La más reciente entre la proyección y la respuesta del último comando: la
 * proyección es eventual y puede ir detrás de lo confirmado.
 */
export function newerAccount(projected: Account | null, confirmed: Account | null): Account | null {
  if (projected === null || confirmed === null) {
    return projected ?? confirmed;
  }
  return confirmed.version > projected.version ? confirmed : projected;
}

/** Versión vigente que informa `409 version_conflict`; `null` si no viene o no es un entero. */
export function conflictVersion(details: readonly ErrorDetailDto[]): number | null {
  const issue = details.find((detail) => detail.field === ACCOUNT_VERSION_CONFLICT_FIELD)?.issue;
  return issue !== undefined && /^\d+$/.test(issue) ? Number(issue) : null;
}
