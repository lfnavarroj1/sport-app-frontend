import {
  HEALTH_SEVERITY_OPTIONS,
  HEALTH_TYPE_OPTIONS,
  NO_HEALTH_FILTERS,
  hasHealthFilters,
  recoveryText,
} from './health-history.model';

describe('Modelo del historial de salud (HU012)', () => {
  it('ofrece los catálogos de tipo y severidad del contrato, en su orden', () => {
    expect(HEALTH_TYPE_OPTIONS).toEqual(['DISCOMFORT', 'INJURY', 'INCAPACITY']);
    expect(HEALTH_SEVERITY_OPTIONS).toEqual(['LOW', 'MODERATE', 'HIGH']);
  });

  it('la recuperación esperada se lee en días, o sin estimación si no se indicó', () => {
    expect(recoveryText(null)).toEqual({ key: 'training.health.recovery.none', params: {} });
    expect(recoveryText(1)).toEqual({ key: 'training.health.recovery.one', params: { days: 1 } });
    expect(recoveryText(0)).toEqual({ key: 'training.health.recovery.days', params: { days: 0 } });
    expect(recoveryText(14)).toEqual({
      key: 'training.health.recovery.days',
      params: { days: 14 },
    });
  });

  it('distingue la consulta sin filtros de una filtrada', () => {
    expect(hasHealthFilters(NO_HEALTH_FILTERS)).toBeFalse();
    expect(hasHealthFilters({ ...NO_HEALTH_FILTERS, from: '2026-10-01' })).toBeTrue();
    expect(hasHealthFilters({ ...NO_HEALTH_FILTERS, to: '2026-10-20' })).toBeTrue();
    expect(hasHealthFilters({ ...NO_HEALTH_FILTERS, type: 'INJURY' })).toBeTrue();
    expect(hasHealthFilters({ ...NO_HEALTH_FILTERS, severity: 'HIGH' })).toBeTrue();
  });
});
