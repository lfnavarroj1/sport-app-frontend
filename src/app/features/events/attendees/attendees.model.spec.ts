import { EVENT_ATTENDEES_RESPONSES } from '../../../../testing/bff-web/event-attendees.fixtures';
import { formatFee, toAttendeesPage } from './attendees.model';

/** Espacios, incluido el de no separación que usa `Intl` entre el signo y el importe. */
const SPACES = /\s/g;

describe('Modelo de inscritos (HU022)', () => {
  it('CA1: transforma la página con identidad mínima, total, conteos y cursor', () => {
    const page = toAttendeesPage(EVENT_ATTENDEES_RESPONSES.firstPage.body);

    expect(page.attendees.length).toBe(20);
    expect(page.attendees[0]).toEqual({
      registrationId: '4e6a8c0d-2f4b-4d6e-8a0c-000000000001',
      displayName: 'Deportista sintético 1',
      status: 'REGISTERED',
      registeredAt: '2026-10-20T14:00:00Z',
      appliedFee: { amount: '45000.00', currency: 'COP' },
    });
    expect(Object.keys(page.attendees[0])).not.toContain('athleteId');
    expect(page.attendees[2].appliedFee).toBeNull();
    expect(page.total).toBe(23);
    expect(page.byStatus).toEqual([{ status: 'REGISTERED', count: 23 }]);
    expect(page.nextCursor).toBe('cursor-sintetico-inscritos-2');
    expect(page.namesAvailable).toBeTrue();
  });

  it('CA3: sin inscritos la colección está vacía y el total es cero', () => {
    const page = toAttendeesPage(EVENT_ATTENDEES_RESPONSES.empty.body);

    expect(page.attendees).toEqual([]);
    expect(page.total).toBe(0);
    expect(page.nextCursor).toBeNull();
  });

  it('CA6: si Usuarios no respondió, los nombres faltan y se marca la fuente', () => {
    const page = toAttendeesPage(EVENT_ATTENDEES_RESPONSES.namesUnavailable.body);

    expect(page.namesAvailable).toBeFalse();
    expect(page.attendees.every((attendee) => attendee.displayName === null)).toBeTrue();
    expect(page.attendees.every((attendee) => attendee.registeredAt !== '')).toBeTrue();
  });

  it('formatea la tarifa aplicada en es-CO desde la cadena decimal', () => {
    expect(formatFee('45000.00', 'COP').replace(SPACES, ' ')).toBe('$ 45.000');
    expect(formatFee('1234.50', 'COP').replace(SPACES, ' ')).toBe('$ 1.234,5');
  });

  it('una moneda que Intl no conoce se muestra con su código', () => {
    expect(formatFee('10.00', 'NO-ISO')).toBe('10.00 NO-ISO');
  });
});
