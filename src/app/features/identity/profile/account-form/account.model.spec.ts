import { ACCOUNT_READ, ACCOUNT_UPDATED } from '../../../../../testing/bff-web/account.fixtures';
import { conflictVersion, newerAccount, toAccount, toAccountRequest } from './account.model';

describe('Modelo de la cuenta (HU002)', () => {
  it('transforma la cuenta proyectada y la confirmada en el mismo modelo de pantalla', () => {
    expect(toAccount(ACCOUNT_READ)).toEqual({
      fullName: 'Persona Sintética',
      email: 'persona@example.com',
      version: 1,
    });
    expect(toAccount(ACCOUNT_UPDATED)).toEqual({
      fullName: 'Persona Renombrada',
      email: 'persona.nueva@example.com',
      version: 2,
    });
  });

  it('la solicitud lleva siempre la versión vigente y solo nombre y correo', () => {
    expect(toAccountRequest({ fullName: 'Ana', email: 'ana@example.com' }, 4)).toEqual({
      expected_version: 4,
      full_name: 'Ana',
      email: 'ana@example.com',
    });
  });

  it('muestra la más reciente entre la proyección y la respuesta del comando', () => {
    const v1 = toAccount(ACCOUNT_READ);
    const v2 = toAccount(ACCOUNT_UPDATED);

    expect(newerAccount(v1, v2)).toBe(v2);
    expect(newerAccount(v2, v1)).toBe(v2);
    expect(newerAccount(v1, null)).toBe(v1);
    expect(newerAccount(null, v2)).toBe(v2);
    expect(newerAccount(null, null)).toBeNull();
  });

  it('lee la versión vigente de version_conflict; sin un entero, null', () => {
    expect(conflictVersion([{ field: 'expected_version', issue: '3' }])).toBe(3);
    expect(conflictVersion([{ field: 'expected_version', issue: 'x' }])).toBeNull();
    expect(conflictVersion([])).toBeNull();
  });
});
