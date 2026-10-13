import {
  countryName,
  formatInZone,
  formatOffset,
  isKnownTimeZone,
  offsetMinutes,
  zonedStartsAt,
} from './event-time';

describe('Fechas y zonas del evento (HU021, ADR-028)', () => {
  it('compone starts_at con el desfase de la zona en ese instante (ejemplo de ADR-028)', () => {
    expect(zonedStartsAt('2026-11-15', '07:00', 'America/Bogota')).toBe(
      '2026-11-15T07:00:00-05:00',
    );
  });

  it('aplica el horario de verano de la zona en la fecha elegida', () => {
    expect(zonedStartsAt('2026-07-01', '09:00', 'America/New_York')).toBe(
      '2026-07-01T09:00:00-04:00',
    );
    expect(zonedStartsAt('2026-12-01', '09:00', 'America/New_York')).toBe(
      '2026-12-01T09:00:00-05:00',
    );
  });

  it('admite desfases con minutos y UTC', () => {
    expect(zonedStartsAt('2026-11-15', '18:30', 'Asia/Kolkata')).toBe('2026-11-15T18:30:00+05:30');
    expect(zonedStartsAt('2026-11-15', '00:00', 'UTC')).toBe('2026-11-15T00:00:00+00:00');
  });

  it('calcula y formatea desfases', () => {
    expect(offsetMinutes('America/Bogota', Date.UTC(2026, 10, 15, 12))).toBe(-300);
    expect(formatOffset(-300)).toBe('-05:00');
    expect(formatOffset(330)).toBe('+05:30');
    expect(formatOffset(0)).toBe('+00:00');
  });

  it('reconoce solo zonas IANA que el navegador conoce', () => {
    expect(isKnownTimeZone('America/Bogota')).toBeTrue();
    expect(isKnownTimeZone('Marte/Base')).toBeFalse();
    expect(isKnownTimeZone('  ')).toBeFalse();
  });

  it('muestra un instante UTC en la hora local del evento', () => {
    const text = formatInZone('2026-11-15T12:00:00Z', 'America/Bogota', 'es');

    expect(text).toContain('15 de noviembre de 2026');
    expect(text).toContain('7:00');
  });

  it('nombra el país solo para un código de dos letras mayúsculas', () => {
    expect(countryName('CO', 'es')).toBe('Colombia');
    expect(countryName('co', 'es')).toBeNull();
    expect(countryName('', 'es')).toBeNull();
  });
});
