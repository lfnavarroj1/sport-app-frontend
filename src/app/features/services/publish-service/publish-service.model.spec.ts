import {
  MY_SERVICE_RESPONSES,
  PUBLISH_SERVICE_RESPONSES,
} from '../../../../testing/bff-web/publish-service.fixtures';
import { futureIntervals, rowFor, toOwnService, toPublishedService } from './publish-service.model';

describe('Modelo de publicación de servicios (HU019)', () => {
  it('ubica cada requisito en su fila; tarifa, unidad y disponibilidad son filas separadas', () => {
    expect(rowFor('name')).toBe('name');
    expect(rowFor('description')).toBe('description');
    expect(rowFor('category')).toBe('category');
    expect(rowFor('modality')).toBe('modality');
    expect(rowFor('price')).toBe('price');
    expect(rowFor('price.amount')).toBe('price');
    expect(rowFor('price.currency')).toBe('price');
    expect(rowFor('price.billing_unit')).toBe('billingUnit');
    expect(rowFor('availability')).toBe('availability');
    expect(rowFor('availability[2].starts_at')).toBe('availability');
  });

  it('un campo sin fila propia solo se informa en el resumen', () => {
    expect(rowFor('provider_id')).toBeNull();
    expect(rowFor('')).toBeNull();
  });

  it('cuenta como futuros solo los horarios que todavía no empiezan', () => {
    const now = Date.UTC(2027, 2, 1, 15);
    const intervals = [
      {
        startsAt: '2027-03-01T14:00:00Z',
        endsAt: '2027-03-01T16:00:00Z',
        timeZone: 'UTC',
        capacity: 1,
      },
      {
        startsAt: '2027-03-01T15:00:00Z',
        endsAt: '2027-03-01T16:00:00Z',
        timeZone: 'UTC',
        capacity: 1,
      },
      {
        startsAt: '2027-03-02T14:00:00Z',
        endsAt: '2027-03-02T15:00:00Z',
        timeZone: 'UTC',
        capacity: 3,
      },
    ];

    expect(futureIntervals(intervals, now)).toEqual([intervals[2]]);
    expect(futureIntervals([], now)).toEqual([]);
  });

  it('toOwnService conserva la oferta, los horarios en UTC con su zona y published_at', () => {
    const service = toOwnService(MY_SERVICE_RESPONSES.published.body);

    expect(service).toEqual(
      jasmine.objectContaining({
        id: MY_SERVICE_RESPONSES.published.body.service_id,
        status: 'PUBLISHED',
        version: 2,
        publishedAt: '2026-10-22T15:00:00Z',
        price: { amount: '120000.00', currency: 'COP', billingUnit: 'SESSION' },
      }),
    );
    expect(service.intervals[0].timeZone).toBe('America/Bogota');
    expect(toOwnService(MY_SERVICE_RESPONSES.draft.body).publishedAt).toBeNull();
  });

  it('toPublishedService traduce la respuesta 200 del comando', () => {
    expect(toPublishedService(PUBLISH_SERVICE_RESPONSES.published.body)).toEqual({
      id: PUBLISH_SERVICE_RESPONSES.published.body.service_id,
      status: 'PUBLISHED',
      version: 2,
      publishedAt: '2026-10-22T15:00:00Z',
      updatedAt: '2026-10-22T15:00:00Z',
    });
  });
});
