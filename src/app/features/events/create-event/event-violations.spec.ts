import { CREATE_EVENT_ISSUES } from '../../../core/api/bff-web/events.api';
import { controlsFor, fieldKey, issueKey } from './event-violations';

describe('Reglas incumplidas del evento (HU021 CA3)', () => {
  it('ubica cada ruta de ADR-028 en su control', () => {
    expect(controlsFor('name')).toEqual(['name']);
    expect(controlsFor('location.country_code')).toEqual(['countryCode']);
    expect(controlsFor('location.name')).toEqual(['locationName']);
    expect(controlsFor('starts_at')).toEqual(['startDate', 'startTime']);
    expect(controlsFor('time_zone')).toEqual(['timeZone']);
    expect(controlsFor('duration_minutes')).toEqual(['durationMinutes']);
  });

  it('no ubica campos ajenos al formulario', () => {
    for (const field of ['organizer_id', 'Idempotency-Key', 'location', '']) {
      expect(controlsFor(field)).withContext(field).toEqual([]);
    }
  });

  it('cada motivo del catálogo tiene su texto; uno desconocido usa el genérico', () => {
    for (const issue of CREATE_EVENT_ISSUES) {
      expect(issueKey(issue)).toBe(`events.create.issues.${issue}`);
    }
    expect(issueKey('otro_motivo')).toBe('events.create.issues.unknown');
  });

  it('nombra el campo, la sección o la solicitud en el resumen', () => {
    expect(fieldKey({ field: 'capacity', issue: 'out_of_range' })).toBe(
      'events.create.fields.capacity',
    );
    expect(fieldKey({ field: 'starts_at', issue: 'not_in_future' })).toBe(
      'events.create.fields.startsAt',
    );
    expect(fieldKey({ field: 'location', issue: 'required' })).toBe(
      'events.create.sections.location',
    );
    expect(fieldKey({ field: 'organizer_id', issue: 'field_not_allowed' })).toBe(
      'events.create.issues.fieldRequest',
    );
  });
});
