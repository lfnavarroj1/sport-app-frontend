import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { toApiError } from '../../../core/api/api-error';
import { BffNotConfiguredError, BffWebUrl } from '../../../core/api/bff-web-url';
import {
  ACTOR_TYPES,
  ActorTypeDto,
  ErrorResponseDto,
  readErrorResponse,
} from '../../../core/api/bff-web/contract';
import { BffWebUsersApi, REGISTER_USER_ERROR_CODES } from '../../../core/api/bff-web/users.api';
import { APP_CONFIG, ConfigValueMissingError } from '../../../core/config/app-config';
import { PRIVACY_NOTICE_VERSION } from '../privacy-notice/privacy-notice.model';
import { RegistrationGateway } from './registration.gateway';
import {
  RegistrationDraft,
  RegistrationField,
  RegistrationOptions,
  RegistrationOutcome,
} from './registration.model';

/** Campo del contrato (`RegisterUserRequest`) → campo del formulario. */
const FIELD_BY_CONTRACT_PROPERTY: Readonly<Record<string, RegistrationField>> = {
  full_name: 'fullName',
  email: 'email',
  password: 'password',
  actor_type: 'actorType',
  accepted_policies_version: 'policies',
};

/** Implementación de HU001 sobre `POST /v1/users` del BFF web (contrato 0.2.0). */
@Injectable()
export class HttpRegistrationGateway extends RegistrationGateway {
  private readonly api = inject(BffWebUsersApi);
  private readonly bffWebUrl = inject(BffWebUrl);
  private readonly config = inject(APP_CONFIG);

  loadOptions(): Promise<RegistrationOptions> {
    if (!this.bffWebUrl.isConfigured) {
      return Promise.reject(new BffNotConfiguredError());
    }
    const policiesVersion = this.config.registrationPoliciesVersion;
    // Solo se ofrece aceptar la versión cuyo aviso muestra la web: con otra versión
    // configurada se aceptaría un texto que el usuario no puede leer.
    if (policiesVersion === null || policiesVersion !== PRIVACY_NOTICE_VERSION) {
      return Promise.reject(new ConfigValueMissingError('registrationPoliciesVersion'));
    }
    return Promise.resolve({
      actorTypes: ACTOR_TYPES.map((code) => ({ code })),
      policiesVersion,
    });
  }

  async register(draft: RegistrationDraft, idempotencyKey: string): Promise<RegistrationOutcome> {
    try {
      const response = await firstValueFrom(
        this.api.registerUser(
          {
            full_name: draft.fullName,
            email: draft.email,
            password: draft.password,
            actor_type: draft.actorType as ActorTypeDto,
            accepted_policies_version: draft.acceptedPoliciesVersion,
          },
          idempotencyKey,
        ),
      );
      return { kind: 'registered', userId: response.user_id, email: response.email };
    } catch (error) {
      return outcomeFromError(error);
    }
  }
}

function outcomeFromError(error: unknown): RegistrationOutcome {
  if (error instanceof HttpErrorResponse) {
    const body = readErrorResponse(error.error);
    if (error.status === 409 && body?.code === REGISTER_USER_ERROR_CODES.emailAlreadyRegistered) {
      return { kind: 'email_taken' };
    }
    if (error.status === 422 && body?.code === REGISTER_USER_ERROR_CODES.policiesVersionMismatch) {
      return { kind: 'policies_outdated' };
    }
    if (error.status === 422 && body?.code === REGISTER_USER_ERROR_CODES.validationError) {
      const fields = invalidFields(body);
      if (fields.length > 0) {
        return { kind: 'invalid', fields };
      }
    }
  }
  // Incluye `idempotency_key_reused`, `upstream_unavailable`, `upstream_timeout`,
  // sin conexión y cualquier respuesta no prevista: nunca se interpreta como éxito.
  return { kind: 'failed', error: toApiError(error) };
}

/**
 * Campos rechazados según `details[].field`. El contrato no fija el formato de
 * `field`; se toma su último segmento (`body.email` → `email`) y se ignoran los
 * que no corresponden a un campo del formulario.
 */
function invalidFields(body: ErrorResponseDto): RegistrationField[] {
  const fields = new Set<RegistrationField>();
  for (const detail of body.details ?? []) {
    const property = detail.field?.split('.').pop();
    const field = property ? FIELD_BY_CONTRACT_PROPERTY[property] : undefined;
    if (field) {
      fields.add(field);
    }
  }
  return [...fields];
}
