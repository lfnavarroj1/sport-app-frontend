import {
  PROFILE_WITH_SPORT_HABITS,
  SPORT_HABITS_SECTION,
  VALID_SPORT_HABITS_PATCH_REQUEST,
  VALID_SPORT_HABITS_REQUEST,
} from '../../../../testing/bff-web/profile.fixtures';
import { ProfileResponseDto, TIME_SLOTS, WEEK_DAYS } from '../../../core/api/bff-web/profile.api';
import {
  SportHabitsDraft,
  inCatalogOrder,
  modifiedSportHabitsSections,
  toAthleteProfile,
  toSportHabits,
  toSportHabitsPatchRequest,
  toSportHabitsRequest,
} from './profile.model';

const DRAFT: SportHabitsDraft = {
  sports: [
    {
      sport: 'running',
      frequencyPerWeek: 3,
      sessionDurationMinutes: 45,
      intensity: 'MODERATE',
      level: 'INTERMEDIATE',
      yearsPracticing: 4,
    },
    {
      sport: 'swimming',
      frequencyPerWeek: 1,
      sessionDurationMinutes: 60,
      intensity: 'LOW',
      level: 'BEGINNER',
      yearsPracticing: null,
    },
  ],
  days: ['MON', 'WED', 'SAT'],
  timeSlots: ['MORNING'],
  primaryGoal: 'HEALTH',
};

describe('Modelo de hábitos deportivos (HU006, ADR-034)', () => {
  describe('toSportHabitsRequest', () => {
    it('CA1: al crear omite expected_version y produce el cuerpo de ADR-034', () => {
      expect(toSportHabitsRequest(DRAFT, null)).toEqual(VALID_SPORT_HABITS_REQUEST);
      expect('expected_version' in toSportHabitsRequest(DRAFT, null)).toBeFalse();
    });

    it('CA4: al reemplazar envía la última versión conocida', () => {
      expect(toSportHabitsRequest(DRAFT, 3).expected_version).toBe(3);
    });

    it('nunca envía user_id; el objetivo y los años opcionales viajan como null', () => {
      const body = toSportHabitsRequest(
        {
          ...DRAFT,
          primaryGoal: null,
          sports: [{ ...DRAFT.sports[0], yearsPracticing: null }],
        },
        null,
      );

      expect('user_id' in body).toBeFalse();
      expect(body.primary_goal).toBeNull();
      expect(body.sports[0].years_practicing).toBeNull();
    });

    it('normaliza días y franjas al orden del catálogo y sin repetir', () => {
      const body = toSportHabitsRequest(
        {
          ...DRAFT,
          days: ['SUN', 'MON', 'SUN', 'WED'],
          timeSlots: ['NIGHT', 'MORNING', 'NIGHT'],
        },
        null,
      );

      expect(body.availability).toEqual({
        days: ['MON', 'WED', 'SUN'],
        time_slots: ['MORNING', 'NIGHT'],
      });
    });

    it('conserva el orden capturado de los deportes, para ubicar sports[i] en su fila', () => {
      const reversed = { ...DRAFT, sports: [DRAFT.sports[1], DRAFT.sports[0]] };

      expect(toSportHabitsRequest(reversed, null).sports.map((habit) => habit.sport)).toEqual([
        'swimming',
        'running',
      ]);
    });
  });

  describe('inCatalogOrder', () => {
    it('ordena por el catálogo, quita repetidos y descarta valores ajenos', () => {
      expect(inCatalogOrder(['FRI', 'TUE', 'TUE'], WEEK_DAYS)).toEqual(['TUE', 'FRI']);
      expect(inCatalogOrder([], TIME_SLOTS)).toEqual([]);
      expect(inCatalogOrder(['X' as 'MORNING', 'EVENING'], TIME_SLOTS)).toEqual(['EVENING']);
    });
  });

  describe('toSportHabits', () => {
    it('CA1: transforma la sección confirmada sin alterar sus valores', () => {
      expect(toSportHabits(SPORT_HABITS_SECTION)).toEqual({
        version: 1,
        sports: DRAFT.sports,
        days: ['MON', 'WED', 'SAT'],
        timeSlots: ['MORNING'],
        primaryGoal: 'HEALTH',
        updatedAt: SPORT_HABITS_SECTION.updated_at,
      });
    });

    it('el perfil proyectado incluye los hábitos, o null si aún no existen', () => {
      const dto = PROFILE_WITH_SPORT_HABITS as unknown as ProfileResponseDto;
      const profile = toAthleteProfile(dto);

      expect(profile.sportHabits?.version).toBe(1);
      expect(profile.sportHabits?.primaryGoal).toBe('HEALTH');
      expect(toAthleteProfile({ ...dto, sport_habits: null }).sportHabits).toBeNull();
    });
  });
});

describe('Actualización parcial de hábitos deportivos (HU008, ADR-035)', () => {
  const current = toSportHabits(SPORT_HABITS_SECTION);

  describe('modifiedSportHabitsSections', () => {
    it('sin cambios no hay secciones que enviar (CA5: nunca un cuerpo vacío)', () => {
      expect(modifiedSportHabitsSections(current, DRAFT)).toEqual([]);
    });

    it('CA1: detecta cada sección por separado', () => {
      const moreRunning = {
        ...DRAFT,
        sports: [{ ...DRAFT.sports[0], frequencyPerWeek: 4 }, DRAFT.sports[1]],
      };

      expect(modifiedSportHabitsSections(current, moreRunning)).toEqual(['sports']);
      expect(modifiedSportHabitsSections(current, { ...DRAFT, days: ['TUE'] })).toEqual([
        'availability',
      ]);
      expect(modifiedSportHabitsSections(current, { ...DRAFT, timeSlots: ['NIGHT'] })).toEqual([
        'availability',
      ]);
      expect(modifiedSportHabitsSections(current, { ...DRAFT, primaryGoal: null })).toEqual([
        'primaryGoal',
      ]);
    });

    it('combina varias secciones en el orden deportes, disponibilidad y objetivo', () => {
      const draft: SportHabitsDraft = {
        sports: [DRAFT.sports[0]],
        days: DRAFT.days,
        timeSlots: ['MORNING', 'EVENING'],
        primaryGoal: 'COMPETITION',
      };

      expect(modifiedSportHabitsSections(current, draft)).toEqual([
        'sports',
        'availability',
        'primaryGoal',
      ]);
    });

    it('el orden de las filas, días o franjas no es un cambio', () => {
      const reordered: SportHabitsDraft = {
        ...DRAFT,
        sports: [DRAFT.sports[1], DRAFT.sports[0]],
        days: ['SAT', 'MON', 'WED'],
      };

      expect(modifiedSportHabitsSections(current, reordered)).toEqual([]);
    });

    it('agregar los años de práctica de un deporte es un cambio de deportes', () => {
      const draft = {
        ...DRAFT,
        sports: [DRAFT.sports[0], { ...DRAFT.sports[1], yearsPracticing: 2 }],
      };

      expect(modifiedSportHabitsSections(current, draft)).toEqual(['sports']);
    });
  });

  describe('toSportHabitsPatchRequest', () => {
    it('CA1: envía expected_version y solo los deportes modificados', () => {
      const draft = {
        ...DRAFT,
        sports: [{ ...DRAFT.sports[0], frequencyPerWeek: 4 }, DRAFT.sports[1]],
      };

      expect(toSportHabitsPatchRequest({ draft, sections: ['sports'] }, 1)).toEqual(
        VALID_SPORT_HABITS_PATCH_REQUEST,
      );
    });

    it('la disponibilidad viaja completa (días y franjas) y normalizada al catálogo', () => {
      const body = toSportHabitsPatchRequest(
        { draft: { ...DRAFT, days: ['SUN', 'TUE'] }, sections: ['availability'] },
        2,
      );

      expect(body).toEqual({
        expected_version: 2,
        availability: { days: ['TUE', 'SUN'], time_slots: ['MORNING'] },
      });
    });

    it('un objetivo borrado viaja como primary_goal: null', () => {
      const body = toSportHabitsPatchRequest(
        { draft: { ...DRAFT, primaryGoal: null }, sections: ['primaryGoal'] },
        3,
      );

      expect(body).toEqual({ expected_version: 3, primary_goal: null });
      expect('primary_goal' in body).toBeTrue();
    });

    it('nunca envía user_id ni las secciones no modificadas', () => {
      const body = toSportHabitsPatchRequest({ draft: DRAFT, sections: ['primaryGoal'] }, 1);

      expect(Object.keys(body).sort()).toEqual(['expected_version', 'primary_goal']);
    });
  });
});
