import {
  DEMOGRAPHIC_SECTION,
  EMPTY_PROFILE,
  FULL_PROFILE,
  PHYSIOLOGICAL_SECTION,
  SIMULATED_HEALTH_CONSENT_VERSION,
  VALID_DEMOGRAPHIC_REQUEST,
  VALID_PHYSIOLOGICAL_REQUEST,
} from '../../../../testing/bff-web/profile.fixtures';
import {
  DemographicDraft,
  PhysiologicalDraft,
  ageOn,
  conflictVersion,
  decimalTenths,
  localDate,
  localDateTimeToUtc,
  newerSection,
  normalizeDecimal,
  toAthleteProfile,
  toDemographicRequest,
  toLocalDateTimeInput,
  toPhysiologicalProfile,
  toPhysiologicalRequest,
} from './profile.model';

const DEMOGRAPHIC_DRAFT: DemographicDraft = {
  birthDate: '1992-04-18',
  gender: 'FEMALE',
  countryCode: 'CO',
  city: 'Bogotá',
  maritalStatus: 'SINGLE',
  occupation: 'Ingeniera',
  incomeRange: '2_4_SMMLV',
};

const PHYSIOLOGICAL_DRAFT: PhysiologicalDraft = {
  consentVersion: SIMULATED_HEALTH_CONSENT_VERSION,
  measuredAt: '2026-10-12T13:00:00Z',
  weightKg: '68.5',
  heightCm: 172,
  restingHeartRateBpm: 58,
  bloodPressure: { systolic: 118, diastolic: 76 },
  bodyTemperatureC: '36.6',
};

describe('profile.model (HU005)', () => {
  describe('solicitudes', () => {
    it('al crear omite expected_version y envía exactamente los campos de ADR-034', () => {
      expect(toDemographicRequest(DEMOGRAPHIC_DRAFT, null)).toEqual(VALID_DEMOGRAPHIC_REQUEST);
      expect(toPhysiologicalRequest(PHYSIOLOGICAL_DRAFT, null)).toEqual(
        VALID_PHYSIOLOGICAL_REQUEST,
      );
    });

    it('al reemplazar envía la última versión conocida', () => {
      expect(toDemographicRequest(DEMOGRAPHIC_DRAFT, 3).expected_version).toBe(3);
      expect(toPhysiologicalRequest(PHYSIOLOGICAL_DRAFT, 1).expected_version).toBe(1);
    });

    it('los opcionales vacíos viajan como null y nunca se envía bmi ni user_id', () => {
      const request = toPhysiologicalRequest(
        {
          ...PHYSIOLOGICAL_DRAFT,
          restingHeartRateBpm: null,
          bloodPressure: null,
          bodyTemperatureC: null,
        },
        null,
      );

      expect(request.resting_heart_rate_bpm).toBeNull();
      expect(request.blood_pressure).toBeNull();
      expect(request.body_temperature_c).toBeNull();
      expect(Object.keys(request)).not.toContain('bmi');
      expect(Object.keys(request)).not.toContain('user_id');
      expect(
        Object.keys(
          toDemographicRequest(
            { ...DEMOGRAPHIC_DRAFT, maritalStatus: null, occupation: null, incomeRange: null },
            null,
          ),
        ),
      ).not.toContain('user_id');
    });
  });

  describe('respuestas', () => {
    it('transforma el perfil proyectado y conserva los decimales como texto', () => {
      const profile = toAthleteProfile(FULL_PROFILE);

      expect(profile.demographic).toEqual({
        version: 1,
        birthDate: DEMOGRAPHIC_SECTION.birth_date,
        gender: 'FEMALE',
        countryCode: 'CO',
        city: 'Bogotá',
        maritalStatus: 'SINGLE',
        occupation: 'Ingeniera',
        incomeRange: '2_4_SMMLV',
        updatedAt: DEMOGRAPHIC_SECTION.updated_at,
      });
      expect(profile.physiological).toEqual({
        version: 1,
        consentVersion: SIMULATED_HEALTH_CONSENT_VERSION,
        consentAcceptedAt: PHYSIOLOGICAL_SECTION.consent.accepted_at,
        measuredAt: PHYSIOLOGICAL_SECTION.measured_at,
        weightKg: '68.5',
        heightCm: 172,
        bmi: '23.2',
        restingHeartRateBpm: 58,
        bloodPressure: { systolic: 118, diastolic: 76 },
        bodyTemperatureC: '36.6',
        updatedAt: PHYSIOLOGICAL_SECTION.updated_at,
      });
      expect(profile.projectedAt).toBe(FULL_PROFILE.projected_at);
    });

    it('las secciones sin datos son null (invitación a registrar, no error)', () => {
      expect(toAthleteProfile(EMPTY_PROFILE)).toEqual({
        demographic: null,
        physiological: null,
        projectedAt: null,
      });
    });

    it('una presión arterial ausente se mantiene null', () => {
      expect(
        toPhysiologicalProfile({ ...PHYSIOLOGICAL_SECTION, blood_pressure: null }).bloodPressure,
      ).toBeNull();
    });
  });

  describe('newerSection', () => {
    const v1 = { version: 1, name: 'proyectada' };
    const v2 = { version: 2, name: 'confirmada' };

    it('conserva la respuesta del comando mientras la proyección no la alcance', () => {
      expect(newerSection(v1, v2)).toBe(v2);
      expect(newerSection(null, v2)).toBe(v2);
    });

    it('usa la proyección cuando ya la alcanzó o la superó', () => {
      expect(newerSection(v2, v1)).toBe(v2);
      expect(newerSection(v2, { version: 2, name: 'igual' })).toBe(v2);
      expect(newerSection(v1, null)).toBe(v1);
      expect(newerSection(null, null)).toBeNull();
    });
  });

  describe('conflictVersion', () => {
    it('lee la versión vigente de details.expected_version', () => {
      expect(conflictVersion([{ field: 'expected_version', issue: '2' }])).toBe(2);
      expect(conflictVersion([{ field: 'expected_version', issue: '0' }])).toBe(0);
    });

    it('devuelve null si no la trae o no es un número', () => {
      expect(conflictVersion([])).toBeNull();
      expect(conflictVersion([{ field: 'otro', issue: '2' }])).toBeNull();
      expect(conflictVersion([{ field: 'expected_version', issue: 'vigente' }])).toBeNull();
    });
  });

  describe('decimales como texto', () => {
    it('acepta coma o punto y no convierte a número', () => {
      expect(normalizeDecimal(' 68,5 ')).toBe('68.5');
      expect(normalizeDecimal('68.5')).toBe('68.5');
      expect(normalizeDecimal('70')).toBe('70');
    });

    it('calcula décimas sin aritmética de coma flotante', () => {
      expect(decimalTenths('68.5')).toBe(685);
      expect(decimalTenths('20')).toBe(200);
      expect(decimalTenths('300.0')).toBe(3000);
      expect(decimalTenths('36.65')).toBeNull();
      expect(decimalTenths('1000')).toBeNull();
      expect(decimalTenths('abc')).toBeNull();
    });
  });

  describe('fechas', () => {
    it('calcula la edad cumplida (informativa)', () => {
      expect(ageOn('1992-04-18', '2026-10-17')).toBe(34);
      expect(ageOn('2013-10-17', '2026-10-17')).toBe(13);
      expect(ageOn('2013-10-18', '2026-10-17')).toBe(12);
      expect(ageOn('', '2026-10-17')).toBeNull();
    });

    it('da formato local a fechas para los controles', () => {
      const date = new Date(2026, 9, 5, 7, 3, 59);

      expect(localDate(date)).toBe('2026-10-05');
      expect(toLocalDateTimeInput(date)).toBe('2026-10-05T07:03');
    });

    it('convierte la fecha y hora locales a UTC con segundos y sufijo Z', () => {
      const local = '2026-10-12T08:00';
      const expected = new Date(2026, 9, 12, 8, 0, 0).toISOString().replace('.000Z', 'Z');

      expect(localDateTimeToUtc(local)).toBe(expected);
      expect(localDateTimeToUtc(local)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$/);
      expect(localDateTimeToUtc('')).toBeNull();
      expect(localDateTimeToUtc('2026-13-45T99:99')).toBeNull();
    });
  });
});
