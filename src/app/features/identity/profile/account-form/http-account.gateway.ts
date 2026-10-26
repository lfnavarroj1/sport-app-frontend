import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { toApiError } from '../../../../core/api/api-error';
import {
  ACCOUNT_ERROR_CODES,
  ACCOUNT_IDEMPOTENT_REPLAYED_HEADER,
  BffWebAccountApi,
} from '../../../../core/api/bff-web/account.api';
import { readErrorResponse } from '../../../../core/api/bff-web/contract';
import { SessionStore } from '../../../../core/session/session.store';
import { AccountGateway } from './account.gateway';
import {
  Account,
  AccountDraft,
  AccountSaveOutcome,
  conflictVersion,
  toAccount,
  toAccountRequest,
} from './account.model';

/** Estados transitorios que se reintentan automáticamente (sin red, 502, 503, 504). */
const TRANSIENT_STATUSES: readonly number[] = [0, 502, 503, 504];

/**
 * Esperas antes de cada reintento automático del comando: hasta tres,
 * progresivas. Configurable para las pruebas.
 */
export const ACCOUNT_RETRY_DELAYS_MS = new InjectionToken<readonly number[]>(
  'ACCOUNT_RETRY_DELAYS_MS',
  { factory: () => [1_000, 2_000, 4_000] },
);

/**
 * Implementación de HU002 sobre `GET /v1/me/account` y `PUT /v1/me/account` del
 * BFF web (contrato 0.28.0). Nombre y correo son datos personales: no se
 * registran en consola ni se guardan fuera de la memoria de la pestaña.
 */
@Injectable()
export class HttpAccountGateway extends AccountGateway {
  private readonly api = inject(BffWebAccountApi);
  private readonly session = inject(SessionStore);
  private readonly retryDelays = inject(ACCOUNT_RETRY_DELAYS_MS);

  async loadAccount(): Promise<Account> {
    const token = this.session.accessToken();
    if (token === null) {
      // Sin access token vigente la sesión termina como vencida y no se llama al BFF.
      this.session.end('expired');
      throw new HttpErrorResponse({ status: 401 });
    }
    try {
      return toAccount(await firstValueFrom(this.api.getAccount(token)));
    } catch (error) {
      this.endIfRejectedToken(error);
      throw error;
    }
  }

  /**
   * Envía el comando con la misma clave en cada intento: si un intento anterior
   * sí se guardó, el BFF devuelve la misma cuenta con `Idempotent-Replayed`.
   */
  async saveAccount(
    draft: AccountDraft,
    expectedVersion: number,
    idempotencyKey: string,
    onRetry?: (attempt: number) => void,
  ): Promise<AccountSaveOutcome> {
    const body = toAccountRequest(draft, expectedVersion);
    for (let attempt = 0; ; attempt++) {
      const token = this.session.accessToken();
      if (token === null) {
        this.session.end('expired');
        return {
          kind: 'failed',
          error: { kind: 'unauthenticated', status: null, code: null, correlationId: null },
        };
      }
      try {
        const response = await firstValueFrom(this.api.putAccount(token, body, idempotencyKey));
        if (response.body === null) {
          // Una respuesta sin cuerpo no confirma la cuenta: no se presenta como éxito.
          return { kind: 'failed', error: toApiError(null) };
        }
        return {
          kind: 'saved',
          account: toAccount(response.body),
          replayed: response.headers.get(ACCOUNT_IDEMPOTENT_REPLAYED_HEADER) === 'true',
        };
      } catch (error) {
        const transient =
          error instanceof HttpErrorResponse && TRANSIENT_STATUSES.includes(error.status);
        if (transient && attempt < this.retryDelays.length) {
          onRetry?.(attempt + 1);
          await delay(this.retryDelays[attempt]);
          continue;
        }
        return this.outcomeFromError(error);
      }
    }
  }

  private outcomeFromError(error: unknown): AccountSaveOutcome {
    if (error instanceof HttpErrorResponse) {
      this.endIfRejectedToken(error);
      const body = readErrorResponse(error.error);
      if (error.status === 422 && body?.code === ACCOUNT_ERROR_CODES.validationError) {
        return {
          kind: 'invalid',
          violations: (body.details ?? []).map((detail) => ({
            field: (detail.field ?? '').replace(/^body\.?/, ''),
            issue: detail.issue,
          })),
        };
      }
      if (error.status === 409 && body?.code === ACCOUNT_ERROR_CODES.emailAlreadyRegistered) {
        return { kind: 'email_taken' };
      }
      if (error.status === 409 && body?.code === ACCOUNT_ERROR_CODES.versionConflict) {
        return { kind: 'conflict', currentVersion: conflictVersion(body.details ?? []) };
      }
    }
    // Incluye `idempotency_key_reused`, transitorios agotados y cualquier respuesta
    // no prevista: nunca se interpreta como éxito.
    return { kind: 'failed', error: toApiError(error) };
  }

  /** `401 invalid_access_token`: el BFF rechazó el access token. */
  private endIfRejectedToken(error: unknown): void {
    if (
      error instanceof HttpErrorResponse &&
      error.status === 401 &&
      readErrorResponse(error.error)?.code === ACCOUNT_ERROR_CODES.invalidAccessToken
    ) {
      this.session.end('expired');
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
