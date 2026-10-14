import { SERVICES_AVAILABILITY_RESPONSES } from '../../../../testing/bff-web/services-availability.fixtures';
import {
  AvailabilityFilters,
  addDays,
  periodDays,
  queryPeriod,
  toAvailabilityPage,
} from './availability.model';

const FILTERS: AvailabilityFilters = {
  fromDate: '2026-11-03',
  toDate: '2026-11-09',
  categories: [],
  modalities: [],
  includeUnavailable: false,
};

/** Desfase local esperado en una fecha, en el mismo formato que `queryPeriod`. */
function localOffset(date: Date): string {
  const offset = -date.getTimezoneOffset();
  const sign = offset < 0 ? '-' : '+';
  const absolute = Math.abs(offset);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
}

describe('Modelo de disponibilidad de servicios (HU020)', () => {
  it('convierte los días locales en el periodo [from, to) con el desfase del navegador', () => {
    const period = queryPeriod(FILTERS);

    expect(period.from).toBe(`2026-11-03T00:00:00${localOffset(new Date(2026, 10, 3))}`);
    expect(period.to).toBe(`2026-11-10T00:00:00${localOffset(new Date(2026, 10, 10))}`);
    // Mismo instante que la medianoche local: no altera el periodo elegido (CA3).
    expect(new Date(period.from).getTime()).toBe(new Date(2026, 10, 3).getTime());
    expect(new Date(period.to).getTime()).toBe(new Date(2026, 10, 10).getTime());
  });

  it('cuenta los días del periodo incluyendo ambos extremos', () => {
    expect(periodDays('2026-11-03', '2026-11-03')).toBe(1);
    expect(periodDays('2026-11-03', '2026-11-09')).toBe(7);
    expect(periodDays('2026-11-01', '2026-12-01')).toBe(31);
    expect(periodDays('2026-11-01', '2026-12-02')).toBe(32);
    expect(periodDays('2026-11-09', '2026-11-03')).toBe(-5);
  });

  it('desplaza días locales, incluido el cambio de mes y de año', () => {
    expect(addDays(new Date(2026, 10, 28), 6)).toBe('2026-12-04');
    expect(addDays(new Date(2026, 11, 30), 3)).toBe('2027-01-02');
    expect(addDays(new Date(2026, 10, 3), 0)).toBe('2026-11-03');
  });

  it('transforma la respuesta sin reordenar ni filtrar (CA4) y conserva lo restringido (CA1)', () => {
    const body = SERVICES_AVAILABILITY_RESPONSES.firstPage.body;
    const page = toAvailabilityPage(body);

    expect(page.services.map((service) => service.id)).toEqual(
      body.items.map((item) => item.service_id),
    );
    expect(page.nextCursor).toBe('cursor-sintetico-servicios-2');
    expect(page.restrictedCategories).toEqual(['SPORTS_MEDICINE']);
    expect(page.services[0]).toEqual({
      id: body.items[0].service_id,
      providerId: body.items[0].provider_id,
      name: body.items[0].name,
      description: body.items[0].description,
      category: body.items[0].category,
      modality: body.items[0].modality,
      price: { amount: '10000.00', currency: 'COP', billingUnit: body.items[0].price.billing_unit },
      intervals: body.items[0].availability.map((interval) => ({
        startsAt: interval.starts_at,
        endsAt: interval.ends_at,
        timeZone: interval.time_zone,
        capacity: interval.capacity,
      })),
      available: true,
    });
  });

  it('conserva los servicios sin espacios marcados como no disponibles (CA2)', () => {
    const page = toAvailabilityPage(SERVICES_AVAILABILITY_RESPONSES.withUnavailable.body);

    expect(page.services.map((service) => service.available)).toEqual([true, false]);
    expect(page.services[1].intervals).toEqual([]);
  });
});
