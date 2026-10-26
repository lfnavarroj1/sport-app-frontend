import {
  PUBLISHED_FREE,
  PUBLISHED_WITH_REGISTRATIONS,
} from '../../../../testing/bff-web/event-pricing.fixtures';
import {
  amountInputValue,
  formatCop,
  hasStarted,
  isFree,
  parseCopAmount,
  toPricedEvent,
} from './event-pricing.model';

describe('Modelo de tarifas de eventos (HU025)', () => {
  describe('parseCopAmount', () => {
    const valid: [string, string][] = [
      ['0', '0.00'],
      ['0,00', '0.00'],
      ['85000', '85000.00'],
      ['85.000', '85000.00'],
      ['85.000,5', '85000.50'],
      ['1.234.567,89', '1234567.89'],
      ['85000,50', '85000.50'],
      ['85000.5', '85000.50'],
      [' 120 000 ', '120000.00'],
      ['007', '7.00'],
      ['99999999,99', '99999999.99'],
    ];
    for (const [input, amount] of valid) {
      it(`«${input}» se envía como ${amount}`, () => {
        expect(parseCopAmount(input)).toEqual({ ok: true, amount });
      });
    }

    const invalid: [string, string][] = [
      ['', 'required'],
      ['   ', 'required'],
      ['-5', 'format'],
      ['85,000.00', 'format'],
      ['abc', 'format'],
      ['1.23.4', 'format'],
      ['85000,505', 'tooManyDecimals'],
      ['10.5555', 'tooManyDecimals'],
      ['100000000', 'outOfRange'],
      ['100.000.000,00', 'outOfRange'],
    ];
    for (const [input, error] of invalid) {
      it(`«${input}» se rechaza por ${error}`, () => {
        expect(parseCopAmount(input)).toEqual({ ok: false, error } as never);
      });
    }
  });

  it('prepara el texto del campo desde la cadena del contrato', () => {
    expect(amountInputValue('85000.00')).toBe('85000');
    expect(amountInputValue('85000.50')).toBe('85000,50');
    expect(amountInputValue('0.00')).toBe('0');
  });

  it('0.00 es gratuito; sin tarifa no lo es', () => {
    expect(isFree({ amount: '0.00', currency: 'COP' })).toBeTrue();
    expect(isFree({ amount: '85000.00', currency: 'COP' })).toBeFalse();
    expect(isFree(null)).toBeFalse();
  });

  it('formatea en pesos colombianos con es-CO', () => {
    const text = formatCop('85000.50');
    expect(text).toContain('85.000,5');
    expect(text).toContain('$');
  });

  it('advierte un inicio pasado sin decidir la regla', () => {
    const now = Date.parse('2027-03-01T12:00:00Z');
    expect(hasStarted('2027-03-01T11:59:59Z', now)).toBeTrue();
    expect(hasStarted('2027-03-01T12:00:01Z', now)).toBeFalse();
  });

  it('transforma OwnEventResponse en el modelo de pantalla', () => {
    expect(toPricedEvent(PUBLISHED_WITH_REGISTRATIONS)).toEqual({
      id: PUBLISHED_WITH_REGISTRATIONS.event_id,
      name: PUBLISHED_WITH_REGISTRATIONS.name,
      discipline: 'Running',
      city: 'Bogotá',
      startsAt: PUBLISHED_WITH_REGISTRATIONS.starts_at,
      timeZone: 'America/Bogota',
      status: 'PUBLISHED',
      version: 2,
      fee: { amount: '85000.00', currency: 'COP' },
      feeUpdatedAt: '2026-10-20T15:00:00Z',
      registrationCount: 3,
    });
    expect(toPricedEvent(PUBLISHED_FREE).fee).toEqual({ amount: '0.00', currency: 'COP' });
  });
});
