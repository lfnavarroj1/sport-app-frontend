import { ACCOUNT_STATEMENT_RESPONSES } from '../../../../testing/bff-web/account-statement.fixtures';
import { AccountStatementResponseDto } from '../../../core/api/bff-web/affiliation.api';
import { formatCop } from '../my-plan/my-plan.model';
import {
  appendMovements,
  browserTimeZone,
  formatStatementInstant,
  planNameKey,
  toAccountStatement,
} from './account-statement.model';

const statement = (dto: AccountStatementResponseDto) => toAccountStatement(dto);

describe('Modelo del estado de cuenta (HU007)', () => {
  it('conserva el estado, la suscripción, los compromisos y el orden de los movimientos del BFF', () => {
    const result = statement(ACCOUNT_STATEMENT_RESPONSES.backToFree.body);

    expect(result.status).toBe('ACTIVE');
    expect(result.subscription?.planCode).toBe('FREE');
    expect(result.commitments.map((item) => item.status)).toEqual(['WAIVED']);
    expect(result.movements.map((item) => item.type)).toEqual([
      'COMMITMENT_WAIVED',
      'RETURNED_TO_FREE',
      'COMMITMENT_CREATED',
      'PLAN_CHANGED',
      'FREE_ACTIVATED',
    ]);
  });

  it('NONE: sin suscripción activa pero con historial', () => {
    const result = statement(ACCOUNT_STATEMENT_RESPONSES.none.body);

    expect(result.status).toBe('NONE');
    expect(result.subscription).toBeNull();
    expect(result.movements.length).toBeGreaterThan(0);
  });

  it('CA5: agrega la página siguiente sin reordenar ni filtrar y adopta su cursor', () => {
    const first = statement(ACCOUNT_STATEMENT_RESPONSES.firstPage.body);
    const last = statement(ACCOUNT_STATEMENT_RESPONSES.lastPage.body);
    expect(first.nextCursor).not.toBeNull();

    const merged = appendMovements(first, {
      movements: last.movements,
      nextCursor: last.nextCursor,
    });

    expect(merged.movements.length).toBe(25);
    expect(merged.movements.map((item) => item.id)).toEqual([
      ...first.movements.map((item) => item.id),
      ...last.movements.map((item) => item.id),
    ]);
    expect(new Set(merged.movements.map((item) => item.id)).size).toBe(25);
    expect(merged.nextCursor).toBeNull();
    // El resto del estado no cambia con la paginación.
    expect(merged.subscription).toBe(first.subscription);
    expect(merged.commitments).toBe(first.commitments);
  });

  it('nombra los planes conocidos y deja el código de uno nuevo', () => {
    expect(planNameKey('PREMIUM')).toBe('affiliation.statement.plans.PREMIUM');
    expect(planNameKey('FREE')).toBe('affiliation.statement.plans.FREE');
    expect(planNameKey('ELITE')).toBeNull();
  });

  it('formatea los importes en COP con es-CO', () => {
    expect(formatCop('14400.00')).toMatch(/^\$\s14\.400$/);
    expect(formatCop('2400.50')).toMatch(/^\$\s2\.400,5$/);
  });

  it('muestra los instantes UTC en la zona indicada con la zona visible', () => {
    const bogota = formatStatementInstant('2026-10-24T15:00:00Z', 'es-CO', 'America/Bogota');
    expect(bogota).toContain('2026');
    expect(bogota).toContain('24');
    expect(bogota).toMatch(/10:00/);
    expect(bogota).toMatch(/GMT-5|COT/);

    const utc = formatStatementInstant('2026-10-24T15:00:00Z', 'es-CO', 'UTC');
    expect(utc).toMatch(/3:00|15:00/);
    expect(utc).toMatch(/UTC/);
  });

  it('usa la zona del navegador por defecto', () => {
    const zone = browserTimeZone();
    expect(zone.length).toBeGreaterThan(0);
    expect(formatStatementInstant('2026-10-24T15:00:00Z', 'es-CO')).toBe(
      formatStatementInstant('2026-10-24T15:00:00Z', 'es-CO', zone),
    );
  });
});
