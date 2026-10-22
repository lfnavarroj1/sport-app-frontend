import {
  CREATED_SERVICE,
  VALID_CREATE_SERVICE_REQUEST,
} from '../../../../testing/bff-web/create-service.fixtures';
import {
  ServiceDraft,
  normalizeAmount,
  toCreateServiceRequest,
  toCreatedService,
} from './create-service.model';

// Datos sintéticos de prueba (ejemplo de ADR-027).
const DRAFT: ServiceDraft = {
  name: 'Valoración deportiva inicial',
  description: 'Valoración presencial para orientar el plan deportivo.',
  category: 'SPORTS_MEDICINE',
  modality: 'IN_PERSON',
  amount: '120000.00',
  billingUnit: 'SESSION',
  intervals: [
    {
      startDate: '2026-11-20',
      startTime: '09:00',
      endDate: '2026-11-20',
      endTime: '10:00',
      timeZone: 'America/Bogota',
      capacity: 1,
    },
  ],
};

describe('Modelo de creación de servicios (HU015)', () => {
  describe('normalizeAmount', () => {
    it('acepta coma o punto como separador decimal sin convertir a número', () => {
      expect(normalizeAmount(' 120000,50 ')).toBe('120000.50');
      expect(normalizeAmount('120000.5')).toBe('120000.5');
      expect(normalizeAmount('0')).toBe('0');
    });

    it('conserva los separadores de miles para que el patrón del contrato los rechace', () => {
      expect(normalizeAmount('120.000,00')).toBe('120.000.00');
    });

    it('conserva la precisión de importes grandes (cadena, nunca punto flotante)', () => {
      expect(normalizeAmount('999999999,99')).toBe('999999999.99');
    });
  });

  describe('toCreateServiceRequest', () => {
    it('CA1 y CA6: arma exactamente el cuerpo de ADR-027 con el desfase de la zona en cada instante', () => {
      expect(toCreateServiceRequest(DRAFT)).toEqual(VALID_CREATE_SERVICE_REQUEST);
    });

    it('CA3: nunca envía provider_id, estado ni datos de pago', () => {
      const body = toCreateServiceRequest(DRAFT) as unknown as Record<string, unknown>;

      expect(Object.keys(body).sort()).toEqual(
        ['availability', 'category', 'description', 'modality', 'name', 'price'].sort(),
      );
      expect(body['price']).toEqual({
        amount: '120000.00',
        currency: 'COP',
        billing_unit: 'SESSION',
      });
    });

    it('CA6: sin intervalos omite availability (la disponibilidad inicial es opcional)', () => {
      const body = toCreateServiceRequest({ ...DRAFT, intervals: [] });

      expect('availability' in body).toBeFalse();
    });

    it('CA7: cero es un servicio gratuito y se envía como cadena', () => {
      expect(toCreateServiceRequest({ ...DRAFT, amount: '0' }).price.amount).toBe('0');
    });

    it('CA6: intervalos contiguos y que cruzan la medianoche conservan su desfase', () => {
      const body = toCreateServiceRequest({
        ...DRAFT,
        intervals: [
          { ...DRAFT.intervals[0], startTime: '22:00', endDate: '2026-11-21', endTime: '06:00' },
          {
            ...DRAFT.intervals[0],
            startDate: '2026-11-21',
            startTime: '06:00',
            endDate: '2026-11-21',
            endTime: '07:00',
          },
        ],
      });

      expect(body.availability).toEqual([
        jasmine.objectContaining({
          starts_at: '2026-11-20T22:00:00-05:00',
          ends_at: '2026-11-21T06:00:00-05:00',
        }),
        jasmine.objectContaining({
          starts_at: '2026-11-21T06:00:00-05:00',
          ends_at: '2026-11-21T07:00:00-05:00',
        }),
      ]);
    });

    it('CA6: el desfase sigue el horario de verano de la zona declarada', () => {
      const body = toCreateServiceRequest({
        ...DRAFT,
        intervals: [
          {
            startDate: '2027-01-15',
            startTime: '10:00',
            endDate: '2027-07-15',
            endTime: '10:00',
            timeZone: 'Europe/Madrid',
            capacity: 2,
          },
        ],
      });

      expect(body.availability![0].starts_at).toBe('2027-01-15T10:00:00+01:00');
      expect(body.availability![0].ends_at).toBe('2027-07-15T10:00:00+02:00');
    });
  });

  it('toCreatedService traduce la respuesta 201 con los instantes en UTC y la zona', () => {
    expect(toCreatedService(CREATED_SERVICE)).toEqual({
      id: CREATED_SERVICE.service_id,
      name: CREATED_SERVICE.name,
      description: CREATED_SERVICE.description,
      category: 'SPORTS_MEDICINE',
      modality: 'IN_PERSON',
      price: { amount: '120000.00', currency: 'COP', billingUnit: 'SESSION' },
      intervals: [
        {
          startsAt: '2026-11-20T14:00:00Z',
          endsAt: '2026-11-20T15:00:00Z',
          timeZone: 'America/Bogota',
          capacity: 1,
        },
      ],
      status: 'DRAFT',
      version: 1,
      createdAt: CREATED_SERVICE.created_at,
    });
  });
});
