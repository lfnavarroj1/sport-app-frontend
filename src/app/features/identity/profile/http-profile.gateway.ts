import { HttpErrorResponse, HttpResponse } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';

import { toApiError } from '../../../core/api/api-error';
import { readErrorResponse } from '../../../core/api/bff-web/contract';
import {
  BffWebProfileApi,
  PROFILE_ERROR_CODES,
  PROFILE_IDEMPOTENT_REPLAYED_HEADER,
} from '../../../core/api/bff-web/profile.api';
import { SessionStore } from '../../../core/session/session.store';
import { ProfileGateway } from './profile.gateway';
import {
  AthleteProfile,
  DemographicDraft,
  DemographicProfile,
  PhysiologicalDraft,
  PhysiologicalProfile,
  SaveOutcome,
  conflictVersion,
  toAthleteProfile,
  toDemographicProfile,
  toDemographicRequest,
  toPhysiologicalProfile,
  toPhysiologicalRequest,
} from './profile.model';

/** Estados transitorios que se reintentan automáticamente (sin red, 502, 503, 504). */
const TRANSIENT_STATUSES: readonly number[] = [0, 502, 503, 504];

/**
 * Esperas antes de cada reintento automático de un comando: hasta tres,
 * progresivas. Configurable para las pruebas.
 */
export const PROFILE_RETRY_DELAYS_MS = new InjectionToken<readonly number[]>(
  'PROFILE_RETRY_DELAYS_MS',
  { factory: () => [1_000, 2_000, 4_000] },
);

/**
 * Implementación de HU005 sobre `GET /v1/me/profile`,
 * `PUT /v1/me/demographic-profile` y `PUT /v1/me/physiological-profile` del BFF
 * web (contrato 0.13.0). Los valores del perfil son datos sensibles: no se
 * registran en consola ni se guardan fuera de la memoria de la pestaña.
 */
@Injectable()
export class HttpProfileGateway extends ProfileGateway {
  private readonly api = inject(BffWebProfileApi);
  private readonly session = inject(SessionStore);
  private readonly retryDelays = inject(PROFILE_RETRY_DELAYS_MS);

  async loadProfile(): Promise<AthleteProfile> {
    const token = this.session.accessToken();
    if (token === null) {
      // Sin access token vigente la sesión termina como vencida y no se llama al BFF.
      this.session.end('expired');
      throw new HttpErrorResponse({ status: 401 });
    }
    try {
      return toAthleteProfile(await firstValueFrom(this.api.getProfile(token)));
    } catch (error) {
      this.endIfRejectedToken(error);
      throw error;
    }
  }

  saveDemographic(
    draft: DemographicDraft,
    expectedVersion: number | null,
    idempotencyKey: string,
    onRetry?: (attempt: number) => void,
  ): Promise<SaveOutcome<DemographicProfile>> {
    const body = toDemographicRequest(draft, expectedVersion);
    return this.save(
      (token) => this.api.putDemographicProfile(token, body, idempotencyKey),
      toDemographicProfile,
      onRetry,
    );
  }

  savePhysiological(
    draft: PhysiologicalDraft,
    expectedVersion: number | null,
    idempotencyKey: string,
    onRetry?: (attempt: number) => void,
  ): Promise<SaveOutcome<PhysiologicalProfile>> {
    const body = toPhysiologicalRequest(draft, expectedVersion);
    return this.save(
      (token) => this.api.putPhysiologicalProfile(token, body, idempotencyKey),
      toPhysiologicalProfile,
      onRetry,
    );
  }

  /**
   * Envía el comando con la misma clave en cada intento: si un intento anterior
   * sí se guardó, el BFF devuelve la misma sección con `Idempotent-Replayed`.
   */
  private async save<Dto, Section>(
    send: (token: string) => Observable<HttpResponse<Dto>>,
    toSection: (dto: Dto) => Section,
    onRetry?: (attempt: number) => void,
  ): Promise<SaveOutcome<Section>> {
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
        const response = await firstValueFrom(send(token));
        if (response.body === null) {
          // Una respuesta sin cuerpo no confirma ninguna sección: no se presenta como éxito.
          return { kind: 'failed', error: toApiError(null) };
        }
        return {
          kind: 'saved',
          section: toSection(response.body),
          created: response.status === 201,
          replayed: response.headers.get(PROFILE_IDEMPOTENT_REPLAYED_HEADER) === 'true',
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

  private outcomeFromError<Section>(error: unknown): SaveOutcome<Section> {
    if (error instanceof HttpErrorResponse) {
      this.endIfRejectedToken(error);
      const body = readErrorResponse(error.error);
      if (error.status === 422 && body?.code === PROFILE_ERROR_CODES.validationError) {
        return {
          kind: 'invalid',
          violations: (body.details ?? []).map((detail) => ({
            field: (detail.field ?? '').replace(/^body\.?/, ''),
            issue: detail.issue,
          })),
        };
      }
      if (error.status === 409 && body?.code === PROFILE_ERROR_CODES.versionConflict) {
        return { kind: 'conflict', currentVersion: conflictVersion(body.details ?? []) };
      }
    }
    // Incluye `permission_required`, `idempotency_key_reused`, transitorios agotados
    // y cualquier respuesta no prevista: nunca se interpreta como éxito.
    return { kind: 'failed', error: toApiError(error) };
  }

  /** `401 invalid_access_token`: el BFF rechazó el access token. */
  private endIfRejectedToken(error: unknown): void {
    if (
      error instanceof HttpErrorResponse &&
      error.status === 401 &&
      readErrorResponse(error.error)?.code === PROFILE_ERROR_CODES.invalidAccessToken
    ) {
      this.session.end('expired');
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
