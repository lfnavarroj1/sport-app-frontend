import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { toApiError } from '../../../core/api/api-error';
import { readErrorResponse } from '../../../core/api/bff-web/contract';
import {
  BffWebTrainingApi,
  GRANT_AUTHORIZATION_ERROR_CODES,
} from '../../../core/api/bff-web/training.api';
import { SessionStore } from '../../../core/session/session.store';
import { SESSION_EXPIRED, accessTokenOrEnd, endSessionIfTokenRejected } from '../training-session';
import { AuthorizationsGateway } from './authorizations.gateway';
import { GrantOutcome, RevokeOutcome } from './authorizations.model';

const CODES = GRANT_AUTHORIZATION_ERROR_CODES;

/**
 * Implementación de HU010 para el deportista sobre
 * `POST /v1/me/training-authorizations` y
 * `DELETE /v1/me/training-authorizations/{professional_id}` (contrato 0.8.0).
 */
@Injectable()
export class HttpAuthorizationsGateway extends AuthorizationsGateway {
  private readonly api = inject(BffWebTrainingApi);
  private readonly session = inject(SessionStore);

  async grant(professionalEmail: string): Promise<GrantOutcome> {
    const token = accessTokenOrEnd(this.session);
    if (token === null) {
      return { kind: 'failed', error: SESSION_EXPIRED };
    }
    try {
      const response = await firstValueFrom(
        this.api.grantAuthorization(token, { professional_email: professionalEmail }),
      );
      const body = response.body;
      if (body === null) {
        // Sin cuerpo no hay autorización confirmada: no se presenta como éxito.
        return { kind: 'failed', error: toApiError(null) };
      }
      return {
        kind: 'granted',
        authorization: {
          professionalEmail,
          professionalId: body.professional_id,
          status: body.status,
          grantedAt: body.granted_at,
          alreadyActive: response.status === 200,
        },
      };
    } catch (error) {
      endSessionIfTokenRejected(this.session, error);
      return grantOutcomeFromError(error);
    }
  }

  async revoke(professionalId: string): Promise<RevokeOutcome> {
    const token = accessTokenOrEnd(this.session);
    if (token === null) {
      return { kind: 'failed', error: SESSION_EXPIRED };
    }
    try {
      await firstValueFrom(this.api.revokeAuthorization(token, professionalId));
      return { kind: 'revoked' };
    } catch (error) {
      endSessionIfTokenRejected(this.session, error);
      return { kind: 'failed', error: toApiError(error) };
    }
  }
}

function grantOutcomeFromError(error: unknown): GrantOutcome {
  if (error instanceof HttpErrorResponse) {
    const code = readErrorResponse(error.error)?.code;
    if (error.status === 404 && code === CODES.professionalNotFound) {
      return { kind: 'professional_not_found' };
    }
    if (error.status === 422 && code === CODES.validationError) {
      return { kind: 'invalid_email' };
    }
  }
  // Incluye `permission_required`, `capability_required`, `upstream_unavailable`,
  // `upstream_timeout`, sin conexión y cualquier respuesta no prevista.
  return { kind: 'failed', error: toApiError(error) };
}
