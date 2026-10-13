import { NO_FILTERS, durationText, hasFilters } from './history.model';

describe('Modelo del historial (HU011)', () => {
  it('presenta la duración en segundos, minutos u horas y minutos', () => {
    expect(durationText(45)).toEqual({
      key: 'training.history.duration.seconds',
      params: { s: 45 },
    });
    expect(durationText(60)).toEqual({
      key: 'training.history.duration.minutes',
      params: { m: 1 },
    });
    expect(durationText(3599)).toEqual({
      key: 'training.history.duration.minutes',
      params: { m: 59 },
    });
    expect(durationText(3900)).toEqual({
      key: 'training.history.duration.hoursMinutes',
      params: { h: 1, m: 5 },
    });
  });

  it('distingue la consulta sin filtros de la filtrada', () => {
    expect(hasFilters(NO_FILTERS)).toBeFalse();
    expect(hasFilters({ ...NO_FILTERS, sport: 'running' })).toBeTrue();
    expect(hasFilters({ ...NO_FILTERS, to: '2026-10-01' })).toBeTrue();
  });
});
