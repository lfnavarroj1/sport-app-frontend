import { CREATE_SERVICE_ISSUES } from '../../../core/api/bff-web/services.api';
import { fieldLabel, issueKey, targetFor } from './service-violations';

describe('Reglas incumplidas de HU015 (ADR-027, decisión 14)', () => {
  it('ubica los campos del servicio y de la tarifa', () => {
    expect(targetFor('name')).toEqual({ kind: 'service', controls: ['name'] });
    expect(targetFor('price.amount')).toEqual({ kind: 'service', controls: ['amount'] });
    expect(targetFor('price.currency')).toEqual({ kind: 'service', controls: ['currency'] });
    expect(targetFor('price.billing_unit')).toEqual({
      kind: 'service',
      controls: ['billingUnit'],
    });
  });

  it('ubica cada propiedad del intervalo por su índice entre corchetes', () => {
    expect(targetFor('availability[0].time_zone')).toEqual({
      kind: 'interval',
      index: 0,
      controls: ['timeZone'],
    });
    expect(targetFor('availability[12].starts_at')).toEqual({
      kind: 'interval',
      index: 12,
      controls: ['startDate', 'startTime'],
    });
    expect(targetFor('availability[1].ends_at')).toEqual({
      kind: 'interval',
      index: 1,
      controls: ['endDate', 'endTime'],
    });
    expect(targetFor('availability[3].capacity')).toEqual({
      kind: 'interval',
      index: 3,
      controls: ['capacity'],
    });
    expect(targetFor('availability[2]')).toEqual({
      kind: 'interval',
      index: 2,
      controls: ['startDate', 'startTime', 'endDate', 'endTime'],
    });
  });

  it('una ruta que no corresponde a un campo editable no marca controles', () => {
    expect(targetFor('provider_id')).toEqual({ kind: 'none' });
    expect(targetFor('availability')).toEqual({ kind: 'none' });
    expect(targetFor('availability[0].otro')).toEqual({ kind: 'none' });
    expect(targetFor('')).toEqual({ kind: 'none' });
  });

  it('explica todos los motivos del catálogo y uno desconocido con un texto genérico', () => {
    for (const issue of CREATE_SERVICE_ISSUES) {
      expect(issueKey(issue)).toBe(`services.create.issues.${issue}`);
    }
    expect(issueKey('motivo_nuevo')).toBe('services.create.issues.unknown');
  });

  it('nombra el campo del resumen, incluido el número del horario', () => {
    expect(fieldLabel({ field: 'price.amount', issue: 'too_many_decimals' })).toEqual({
      key: 'services.create.fields.amount',
      number: null,
      fieldKey: null,
    });
    expect(
      fieldLabel({ field: 'availability[1].starts_at', issue: 'overlapping_interval' }),
    ).toEqual({
      key: 'services.create.intervals.fieldOf',
      number: 2,
      fieldKey: 'services.create.summary.startsAt',
    });
    expect(fieldLabel({ field: 'availability', issue: 'too_many_intervals' }).key).toBe(
      'services.create.sections.availability',
    );
    expect(fieldLabel({ field: 'provider_id', issue: 'field_not_allowed' }).key).toBe(
      'services.create.issues.fieldRequest',
    );
  });
});
