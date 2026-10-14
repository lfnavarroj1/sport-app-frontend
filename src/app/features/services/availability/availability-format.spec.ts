import { browserTimeZone, formatIntervalRange, formatPrice } from './availability-format';

/** Normaliza los espacios no separables que usa `Intl`. */
function plain(text: string): string {
  return text.replace(/\s/g, ' ');
}

describe('availability-format (HU020)', () => {
  it('formatPrice muestra pesos colombianos sin decimales innecesarios', () => {
    expect(plain(formatPrice('10000.00'))).toBe('$ 10.000');
    expect(plain(formatPrice('0.00'))).toBe('$ 0');
  });

  it('formatPrice conserva hasta dos decimales', () => {
    expect(plain(formatPrice('15000.50'))).toBe('$ 15.000,5');
    expect(plain(formatPrice('999999999.99'))).toBe('$ 999.999.999,99');
  });

  it('browserTimeZone devuelve la zona IANA del navegador', () => {
    expect(browserTimeZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(browserTimeZone().length).toBeGreaterThan(0);
  });

  describe('formatIntervalRange (CA3)', () => {
    const locale = 'es';

    it('muestra el instante en la zona indicada, sin alterarlo', () => {
      // 13:00Z es 08:00 en Bogotá (UTC-5) y 14:00 en Madrid (UTC+1 en noviembre).
      const bogota = formatIntervalRange(
        '2026-11-03T13:00:00Z',
        '2026-11-03T14:00:00Z',
        locale,
        'America/Bogota',
      );
      const madrid = formatIntervalRange(
        '2026-11-03T13:00:00Z',
        '2026-11-03T14:00:00Z',
        locale,
        'Europe/Madrid',
      );

      expect(bogota.start).toContain('8:00');
      expect(bogota.end).toBe(
        new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone: 'America/Bogota' }).format(
          new Date('2026-11-03T14:00:00Z'),
        ),
      );
      expect(madrid.start).toContain('14:00');
      expect(madrid.end).toContain('15:00');
    });

    it('el inicio lleva fecha y hora; el fin del mismo día local, solo la hora', () => {
      const range = formatIntervalRange(
        '2026-11-03T13:00:00Z',
        '2026-11-03T14:30:00Z',
        locale,
        'America/Bogota',
      );

      expect(range.start).toBe(
        new Intl.DateTimeFormat(locale, {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: 'America/Bogota',
        }).format(new Date('2026-11-03T13:00:00Z')),
      );
      expect(range.start).toContain('2026');
      expect(range.end).not.toContain('2026');
    });

    it('si el fin cae otro día local muestra también su fecha', () => {
      // 04:00Z del 4 de noviembre aún es el 3 en Bogotá, pero ya es el 4 en UTC.
      const sameInBogota = formatIntervalRange(
        '2026-11-03T22:00:00Z',
        '2026-11-04T04:00:00Z',
        locale,
        'America/Bogota',
      );
      const otherDayInUtc = formatIntervalRange(
        '2026-11-03T22:00:00Z',
        '2026-11-04T04:00:00Z',
        locale,
        'UTC',
      );

      expect(sameInBogota.end).not.toContain('2026');
      expect(otherDayInUtc.end).toContain('2026');
    });

    it('por defecto usa la zona del navegador', () => {
      const zone = browserTimeZone();

      expect(formatIntervalRange('2026-11-03T13:00:00Z', '2026-11-05T14:00:00Z', locale)).toEqual(
        formatIntervalRange('2026-11-03T13:00:00Z', '2026-11-05T14:00:00Z', locale, zone),
      );
    });
  });
});
