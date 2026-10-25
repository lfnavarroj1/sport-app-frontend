import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import {
  ACCOUNT_STATEMENT_ERROR_CODES,
  AccountStatementResponseDto,
  BffWebAffiliationApi,
} from '../../../core/api/bff-web/affiliation.api';
import { readErrorResponse } from '../../../core/api/bff-web/contract';
import { SessionStore } from '../../../core/session/session.store';
import { AccountStatementGateway } from './account-statement.gateway';
import {
  AccountStatement,
  MovementsPage,
  STATEMENT_PAGE_SIZE,
  toAccountStatement,
} from './account-statement.model';

/**
 * Implementación de HU007 sobre `GET /v1/me/account-statement` (contrato bff-web
 * 0.27.0 o superior). Quien consulta sale del token: no existe consulta de cuentas
 * ajenas (CA3). Es una consulta sin efectos; los fallos se informan y el
 * reintento lo decide la persona.
 */
@Injectable()
export class HttpAccountStatementGateway extends AccountStatementGateway {
  private readonly api = inject(BffWebAffiliationApi);
  private readonly session = inject(SessionStore);

  async load(): Promise<AccountStatement> {
    return toAccountStatement(await this.fetch(null));
  }

  async loadMore(cursor: string): Promise<MovementsPage> {
    const statement = toAccountStatement(await this.fetch(cursor));
    return { movements: statement.movements, nextCursor: statement.nextCursor };
  }

  private async fetch(cursor: string | null): Promise<AccountStatementResponseDto> {
    const token = this.session.accessToken();
    if (token === null) {
      this.session.end('expired');
      throw new HttpErrorResponse({ status: 401 });
    }
    try {
      return await firstValueFrom(this.api.getAccountStatement(token, cursor, STATEMENT_PAGE_SIZE));
    } catch (error) {
      if (
        error instanceof HttpErrorResponse &&
        error.status === 401 &&
        readErrorResponse(error.error)?.code === ACCOUNT_STATEMENT_ERROR_CODES.invalidAccessToken
      ) {
        this.session.end('expired');
      }
      throw error;
    }
  }
}
