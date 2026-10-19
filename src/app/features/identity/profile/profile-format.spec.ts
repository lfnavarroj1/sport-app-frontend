import {
  countryName,
  formatBirthDate,
  formatCountry,
  formatDecimal,
  formatInstant,
} from './profile-format';

const LOCALE = 'es';

describe('Formatos del perfil (HU005)', () => {
  it('muestra la fecha de nacimiento en fecha larga, sin desfase de zona', () => {
    expect(formatBirthDate('1992-04-18', LOCALE)).toBe('18 de abril de 1992');
    expect(formatBirthDate('2000-01-01', LOCALE)).toBe('1 de enero de 2000');
    expect(formatBirthDate('no-es-fecha', LOCALE)).toBe('no-es-fecha');
  });

  it('muestra los instantes en la zona indicada, con fecha larga y hora corta', () => {
    const bogota = formatInstant('2026-10-12T13:00:00Z', LOCALE, 'America/Bogota');
    expect(bogota).toContain('12 de octubre de 2026');
    expect(bogota).toContain('8:00');
    expect(formatInstant('2026-10-12T13:00:00Z', LOCALE, 'UTC')).toContain('13:00');
  });

  it('cambia el separador decimal sin pasar el texto por Number', () => {
    expect(formatDecimal('68.5', LOCALE)).toBe('68,5');
    expect(formatDecimal('23.2', LOCALE)).toBe('23,2');
    expect(formatDecimal('70', LOCALE)).toBe('70');
    expect(formatDecimal('70.0', LOCALE)).toBe('70,0');
    expect(formatDecimal('68.5', 'en')).toBe('68.5');
  });

  it('nombra el país y conserva su código', () => {
    expect(countryName('CO', LOCALE)).toBe('Colombia');
    expect(countryName('co', LOCALE)).toBeNull();
    expect(formatCountry('CO', LOCALE)).toBe('Colombia (CO)');
    expect(formatCountry('QM', LOCALE)).toBe('QM');
  });
});
