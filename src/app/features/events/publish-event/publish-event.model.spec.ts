import {
  EVENT_DETAIL_RESPONSES,
  PUBLISH_EVENT_RESPONSES,
} from '../../../../testing/bff-web/publish-event.fixtures';
import { rowFor, startsInPast, toEventDetail, toOrganizerEvent } from './publish-event.model';

describe('Modelo de publicación de eventos (HU024)', () => {
  describe('rowFor', () => {
    it('ubica cada requisito de ADR-028 en la fila del detalle que lo muestra', () => {
      expect(rowFor('name')).toBe('name');
      expect(rowFor('description')).toBe('description');
      expect(rowFor('discipline')).toBe('discipline');
      expect(rowFor('location')).toBe('location');
      expect(rowFor('location.city')).toBe('location');
      expect(rowFor('location.country_code')).toBe('location');
      expect(rowFor('starts_at')).toBe('startsAt');
      expect(rowFor('ends_at')).toBe('endsAt');
      expect(rowFor('duration_minutes')).toBe('endsAt');
      expect(rowFor('time_zone')).toBe('timeZone');
      expect(rowFor('capacity')).toBe('capacity');
    });

    it('un campo sin fila propia se informa solo en el resumen', () => {
      expect(rowFor('')).toBeNull();
      expect(rowFor('header.idempotency-key')).toBeNull();
    });
  });

  describe('startsInPast', () => {
    const now = Date.UTC(2026, 9, 18, 15);

    it('advierte cuando el inicio ya pasó o es ahora', () => {
      expect(startsInPast('2026-10-18T14:59:00Z', now)).toBeTrue();
      expect(startsInPast('2026-10-18T15:00:00Z', now)).toBeTrue();
    });

    it('no advierte con un inicio futuro', () => {
      expect(startsInPast('2026-10-18T15:01:00Z', now)).toBeFalse();
    });
  });

  it('transforma el agregado confirmado sin perder versión ni published_at', () => {
    const dto = PUBLISH_EVENT_RESPONSES.published.body;

    expect(toOrganizerEvent(dto)).toEqual(
      jasmine.objectContaining({
        id: dto.event_id,
        status: 'PUBLISHED',
        version: dto.version,
        publishedAt: dto.published_at,
        timeZone: 'America/Bogota',
        location: jasmine.objectContaining({ countryCode: 'CO', address: dto.location.address }),
      }),
    );
  });

  it('transforma el detalle del canal web', () => {
    const dto = EVENT_DETAIL_RESPONSES.published.body;

    expect(toEventDetail(dto)).toEqual({
      id: dto.event_id,
      name: dto.name,
      description: dto.description,
      discipline: dto.discipline,
      location: { name: dto.location.name, city: dto.location.city, countryCode: 'CO' },
      startsAt: dto.starts_at,
      endsAt: dto.ends_at,
      timeZone: dto.time_zone,
      capacity: dto.capacity,
      status: 'PUBLISHED',
      version: dto.version,
    });
  });
});
