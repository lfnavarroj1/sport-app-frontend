import { PROFILE_ISSUES } from '../../../core/api/bff-web/profile.api';
import {
  sportHabitsFieldText,
  sportHabitsIssueKey,
  sportHabitsTarget,
} from './sport-habits-violations';

describe('Reglas incumplidas de los hábitos deportivos (HU006 CA2)', () => {
  it('ubica cada deporte por su posición y su campo', () => {
    expect(sportHabitsTarget('sports[1].sport')).toEqual({
      kind: 'sport',
      index: 1,
      control: 'sport',
    });
    expect(sportHabitsTarget('sports[0].frequency_per_week')).toEqual({
      kind: 'sport',
      index: 0,
      control: 'frequencyPerWeek',
    });
    expect(sportHabitsTarget('sports[4].session_duration_minutes')).toEqual({
      kind: 'sport',
      index: 4,
      control: 'sessionDurationMinutes',
    });
    expect(sportHabitsTarget('sports[2].intensity')).toEqual(
      jasmine.objectContaining({ control: 'intensity' }),
    );
    expect(sportHabitsTarget('sports[2].level')).toEqual(
      jasmine.objectContaining({ control: 'level' }),
    );
    expect(sportHabitsTarget('sports[2].years_practicing')).toEqual(
      jasmine.objectContaining({ control: 'yearsPracticing' }),
    );
  });

  it('una regla de la fila completa o de un campo ajeno no nombra control', () => {
    expect(sportHabitsTarget('sports[3]')).toEqual({ kind: 'sport', index: 3, control: null });
    expect(sportHabitsTarget('sports[0].user_id')).toEqual({
      kind: 'sport',
      index: 0,
      control: null,
    });
    expect(sportHabitsTarget('sports[0].constructor')).toEqual({
      kind: 'sport',
      index: 0,
      control: null,
    });
  });

  it('ubica la lista, la disponibilidad y el objetivo', () => {
    expect(sportHabitsTarget('sports')).toEqual({ kind: 'sports' });
    expect(sportHabitsTarget('availability.days')).toEqual({ kind: 'days' });
    expect(sportHabitsTarget('availability.days[0]')).toEqual({ kind: 'days' });
    expect(sportHabitsTarget('availability.time_slots')).toEqual({ kind: 'timeSlots' });
    expect(sportHabitsTarget('availability.time_slots[3]')).toEqual({ kind: 'timeSlots' });
    expect(sportHabitsTarget('availability')).toEqual({ kind: 'availability' });
    expect(sportHabitsTarget('primary_goal')).toEqual({ kind: 'primaryGoal' });
  });

  it('no ubica campos ajenos al formulario', () => {
    for (const field of ['user_id', 'Idempotency-Key', 'expected_version', 'sports[x]', '']) {
      expect(sportHabitsTarget(field)).withContext(field).toEqual({ kind: 'none' });
    }
  });

  it('un deporte repetido y un sexto deporte explican qué hacer', () => {
    expect(sportHabitsIssueKey({ field: 'sports[1].sport', issue: 'duplicate_value' })).toBe(
      'profile.habits.issues.duplicateSport',
    );
    expect(sportHabitsIssueKey({ field: 'sports', issue: 'too_many_items' })).toBe(
      'profile.habits.issues.tooManySports',
    );
  });

  it('los demás motivos usan el catálogo común; uno desconocido, el genérico', () => {
    for (const issue of PROFILE_ISSUES) {
      expect(sportHabitsIssueKey({ field: 'availability.days[0]', issue })).toBe(
        `profile.issues.${issue}`,
      );
    }
    expect(sportHabitsIssueKey({ field: 'sports', issue: 'otro_motivo' })).toBe(
      'profile.issues.unknown',
    );
  });

  it('nombra el campo del resumen con el número de fila (desde 1)', () => {
    expect(sportHabitsFieldText({ field: 'sports[1].sport', issue: 'duplicate_value' })).toEqual({
      key: 'profile.habits.violationFields.sport',
      params: { n: 2 },
    });
    expect(sportHabitsFieldText({ field: 'sports[0]', issue: 'required' })).toEqual({
      key: 'profile.habits.violationFields.row',
      params: { n: 1 },
    });
    expect(sportHabitsFieldText({ field: 'availability.days[1]', issue: 'x' })).toEqual({
      key: 'profile.habits.violationFields.days',
      params: {},
    });
    expect(sportHabitsFieldText({ field: 'user_id', issue: 'field_not_allowed' })).toEqual({
      key: 'profile.issues.fieldRequest',
      params: {},
    });
  });
});
