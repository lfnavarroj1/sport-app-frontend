import {
  FREE_SUBSCRIPTION,
  INTERMEDIATE_OWN_CAPABILITIES,
  PLANS_RESPONSES,
  PREMIUM_QUARTERLY_SUBSCRIPTION,
  PROVISIONING_SUBSCRIPTION,
  plansResponse,
} from '../../../../testing/bff-web/affiliation.fixtures';
import { FREE_CAPABILITIES } from '../../../../testing/bff-web/capabilities.fixtures';
import es from '../../../../../public/i18n/es.json';
import {
  KNOWN_CAPABILITIES,
  PlanOption,
  canChoose,
  capabilityChanges,
  capabilityKey,
  choosablePeriodicities,
  formatCop,
  toCatalog,
  toChangeRequest,
  toSubscription,
} from './my-plan.model';

/** Espacios, incluido el de no separación que usa `Intl` entre el signo y el importe. */
const NBSP = /\s/g;
const catalog = toCatalog(PLANS_RESPONSES.free.body);
const [FREE, INTERMEDIATE, PREMIUM] = catalog.plans;

describe('Modelo de «Mi plan» (HU016)', () => {
  describe('toCatalog', () => {
    it('ordena los planes por nivel aunque el BFF los entregue en otro orden', () => {
      const body = plansResponse('FREE');
      const shuffled = toCatalog({ ...body, plans: [...body.plans].reverse() });

      expect(shuffled.plans.map((plan) => plan.level)).toEqual([1, 2, 3]);
      expect(shuffled.currentPlanCode).toBe('FREE');
      expect(shuffled.catalogVersion).toBe('plans-2026-10-13.v1');
    });

    it('separa capacidades propias y heredadas por nivel, sin comparar nombres de plan', () => {
      expect(FREE.ownCapabilities).toEqual([...FREE_CAPABILITIES]);
      expect(FREE.inheritedCapabilities).toEqual([]);
      expect(INTERMEDIATE.ownCapabilities).toEqual([...INTERMEDIATE_OWN_CAPABILITIES]);
      expect(INTERMEDIATE.inheritedCapabilities).toEqual([...FREE_CAPABILITIES]);
      expect(PREMIUM.ownCapabilities).toEqual([
        'services.sports_medicine.access',
        'services.virtual_sessions.schedule',
      ]);
      expect(PREMIUM.inheritedCapabilities.length).toBe(14);
    });

    it('los mismos niveles con otros nombres producen la misma comparación', () => {
      const body = plansResponse('FREE');
      const renamed = toCatalog({
        ...body,
        plans: body.plans.map((plan) => ({ ...plan, plan_code: `X${plan.level}`, name: 'Otro' })),
      });

      expect(renamed.plans.map((plan) => plan.ownCapabilities)).toEqual(
        catalog.plans.map((plan) => plan.ownCapabilities),
      );
    });

    it('un plan es pago si tiene ofertas con periodicidad', () => {
      expect(FREE.paid).toBeFalse();
      expect(INTERMEDIATE.paid).toBeTrue();
      expect(PREMIUM.offers).toEqual([
        { periodicity: 'MONTHLY', price: '4800.00', durationMonths: 1 },
        { periodicity: 'QUARTERLY', price: '14400.00', durationMonths: 3 },
        { periodicity: 'ANNUAL', price: '57600.00', durationMonths: 12 },
      ]);
    });

    it('CA7: en PROVISIONING no hay plan actual', () => {
      expect(toCatalog(PLANS_RESPONSES.provisioning.body).currentPlanCode).toBeNull();
    });
  });

  it('transforma la suscripción, incluida la de PROVISIONING con campos nulos', () => {
    expect(toSubscription(PREMIUM_QUARTERLY_SUBSCRIPTION)).toEqual({
      status: 'ACTIVE',
      planCode: 'PREMIUM',
      periodicity: 'QUARTERLY',
      price: '14400.00',
      periodStart: '2026-10-24T15:00:00Z',
      periodEnd: '2027-01-24T15:00:00Z',
      version: 2,
    });
    expect(toSubscription(PROVISIONING_SUBSCRIPTION)).toEqual(
      jasmine.objectContaining({ status: 'PROVISIONING', planCode: null, version: null }),
    );
  });

  it('el cuerpo del cambio tiene exactamente los campos del contrato', () => {
    expect(
      toChangeRequest({ planCode: 'PREMIUM', periodicity: 'QUARTERLY', expectedVersion: 1 }),
    ).toEqual({ plan_code: 'PREMIUM', periodicity: 'QUARTERLY', expected_subscription_version: 1 });
  });

  describe('elección', () => {
    const free = toSubscription(FREE_SUBSCRIPTION);
    const premiumQuarterly = toSubscription(PREMIUM_QUARTERLY_SUBSCRIPTION);

    it('la periodicidad solo se elige en planes pagos', () => {
      expect(choosablePeriodicities(FREE)).toEqual(['NONE']);
      expect(choosablePeriodicities(PREMIUM)).toEqual(['MONTHLY', 'QUARTERLY', 'ANNUAL']);
    });

    it('el plan gratuito vigente no se ofrece; los pagos sí', () => {
      expect(canChoose(FREE, free)).toBeFalse();
      expect(canChoose(INTERMEDIATE, free)).toBeTrue();
      expect(canChoose(PREMIUM, free)).toBeTrue();
    });

    it('el plan pago vigente se ofrece para cambiar de periodicidad, y se puede volver a FREE', () => {
      expect(canChoose(PREMIUM, premiumQuarterly)).toBeTrue();
      expect(canChoose(FREE, premiumQuarterly)).toBeTrue();
    });

    it('nada se ofrece en PROVISIONING ni si el plan no es seleccionable', () => {
      const provisioning = toSubscription(PROVISIONING_SUBSCRIPTION);
      const locked: PlanOption = { ...PREMIUM, selectable: false };

      expect(catalog.plans.some((plan) => canChoose(plan, provisioning))).toBeFalse();
      expect(canChoose(locked, free)).toBeFalse();
    });

    it('al subir se ganan capacidades y al bajar se pierden', () => {
      expect(capabilityChanges(FREE, PREMIUM)).toEqual({
        gained: [...INTERMEDIATE_OWN_CAPABILITIES, ...PREMIUM.ownCapabilities],
        lost: [],
      });
      expect(capabilityChanges(PREMIUM, FREE)).toEqual({
        gained: [],
        lost: [...INTERMEDIATE_OWN_CAPABILITIES, ...PREMIUM.ownCapabilities],
      });
      expect(capabilityChanges(null, FREE).gained).toEqual([...FREE_CAPABILITIES]);
    });
  });

  describe('formatCop', () => {
    it('formatea en es-CO desde la cadena decimal, sin decimales en cero', () => {
      expect(formatCop('2400.00').replace(NBSP, ' ')).toBe('$ 2.400');
      expect(formatCop('57600.00').replace(NBSP, ' ')).toBe('$ 57.600');
      expect(formatCop('1234.50').replace(NBSP, ' ')).toBe('$ 1.234,5');
      expect(formatCop('0.00').replace(NBSP, ' ')).toBe('$ 0');
    });
  });

  describe('capabilityKey', () => {
    it('toda capacidad del catálogo tiene nombre en es.json', () => {
      const labels = (es as { affiliation: { capabilities: Record<string, string> } }).affiliation
        .capabilities;
      for (const code of PREMIUM.capabilities) {
        const key = capabilityKey(code);
        expect(key).withContext(code).not.toBeNull();
        expect(labels[key!.replace('affiliation.capabilities.', '')])
          .withContext(code)
          .toBeTruthy();
      }
      expect(Object.keys(labels).length).toBe(KNOWN_CAPABILITIES.length);
    });

    it('una capacidad desconocida no tiene clave: se muestra su código', () => {
      expect(capabilityKey('nueva.capacidad')).toBeNull();
    });
  });
});
