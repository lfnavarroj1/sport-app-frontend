import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { readErrorResponse } from '../../../core/api/bff-web/contract';
import {
  BffWebServicesAvailabilityApi,
  SERVICES_AVAILABILITY_ERROR_CODES,
  SERVICES_AVAILABILITY_LIMITS,
  ServicesAvailabilityQueryDto,
} from '../../../core/api/bff-web/services-availability.api';
import { SessionStore } from '../../../core/session/session.store';
import { AvailabilityGateway } from './availability.gateway';
import {
  AvailabilityFilters,
  AvailabilityPage,
  queryPeriod,
  toAvailabilityPage,
} from './availability.model';

/**
 * Implementación de HU020 sobre `GET /v1/services/availability` (contrato
 * bff-web 0.12.0). Usa el tamaño de página por defecto del contrato y envía el
 * cursor tal como lo entregó el backend.
 */
@Injectable()
export class HttpAvailabilityGateway extends AvailabilityGateway {
  private readonly api = inject(BffWebServicesAvailabilityApi);
  private readonly session = inject(SessionStore);

  async loadPage(filters: AvailabilityFilters, cursor: string | null): Promise<AvailabilityPage> {
    const token = this.session.accessToken();
    if (token === null) {
      // Sin access token vigente la sesión termina como vencida y no se llama al BFF.
      this.session.end('expired');
      throw new HttpErrorResponse({ status: 401 });
    }
    const query: ServicesAvailabilityQueryDto = {
      ...queryPeriod(filters),
      category: filters.categories,
      modality: filters.modalities,
      availability: filters.includeUnavailable ? 'all' : 'available',
      limit: SERVICES_AVAILABILITY_LIMITS.pageDefault,
      cursor,
    };
    try {
      return toAvailabilityPage(await firstValueFrom(this.api.getAvailability(token, query)));
    } catch (error) {
      if (isRejectedToken(error)) {
        this.session.end('expired');
      }
      throw error;
    }
  }
}

/** `401 invalid_access_token`: el BFF rechazó el access token. */
function isRejectedToken(error: unknown): boolean {
  return (
    error instanceof HttpErrorResponse &&
    error.status === 401 &&
    readErrorResponse(error.error)?.code === SERVICES_AVAILABILITY_ERROR_CODES.invalidAccessToken
  );
}
