import { PROFILE_ISSUES } from '../../../core/api/bff-web/profile.api';
import { controlsFor, fieldKey, issueKey } from './profile-violations';

describe('Reglas incumplidas del perfil (HU005 CA2 y CA3)', () => {
  it('ubica cada ruta de ADR-034 en su control', () => {
    expect(controlsFor('birth_date')).toEqual(['birthDate']);
    expect(controlsFor('country_code')).toEqual(['countryCode']);
    expect(controlsFor('marital_status')).toEqual(['maritalStatus']);
    expect(controlsFor('income_range')).toEqual(['incomeRange']);
    expect(controlsFor('consent')).toEqual(['consent']);
    expect(controlsFor('consent.version')).toEqual(['consent']);
    expect(controlsFor('measured_at')).toEqual(['measuredAt']);
    expect(controlsFor('weight_kg')).toEqual(['weightKg']);
    expect(controlsFor('height_cm')).toEqual(['heightCm']);
    expect(controlsFor('resting_heart_rate_bpm')).toEqual(['restingHeartRateBpm']);
    expect(controlsFor('blood_pressure')).toEqual(['systolic', 'diastolic']);
    expect(controlsFor('blood_pressure.systolic_mmhg')).toEqual(['systolic']);
    expect(controlsFor('blood_pressure.diastolic_mmhg')).toEqual(['diastolic']);
    expect(controlsFor('body_temperature_c')).toEqual(['bodyTemperatureC']);
  });

  it('no ubica campos ajenos al formulario', () => {
    for (const field of ['bmi', 'user_id', 'Idempotency-Key', 'toString', '']) {
      expect(controlsFor(field)).withContext(field).toEqual([]);
    }
  });

  it('cada motivo del catálogo tiene su texto; uno desconocido usa el genérico', () => {
    for (const issue of PROFILE_ISSUES) {
      expect(issueKey({ field: 'weight_kg', issue })).toBe(`profile.issues.${issue}`);
    }
    expect(issueKey({ field: 'weight_kg', issue: 'otro_motivo' })).toBe('profile.issues.unknown');
  });

  it('CA3: el consentimiento indica la acción necesaria', () => {
    expect(issueKey({ field: 'consent.version', issue: 'unsupported_consent_version' })).toBe(
      'profile.physiological.consent.issues.unsupported_consent_version',
    );
    expect(issueKey({ field: 'consent', issue: 'required' })).toBe(
      'profile.physiological.consent.issues.required',
    );
    expect(issueKey({ field: 'consent.version', issue: 'invalid_length' })).toBe(
      'profile.issues.invalid_length',
    );
  });

  it('nombra el campo o la solicitud en el resumen', () => {
    expect(fieldKey({ field: 'birth_date', issue: 'out_of_range' })).toBe(
      'profile.demographic.fields.birthDate',
    );
    expect(fieldKey({ field: 'weight_kg', issue: 'out_of_range' })).toBe(
      'profile.physiological.fields.weightKg',
    );
    expect(fieldKey({ field: 'blood_pressure', issue: 'inconsistent_values' })).toBe(
      'profile.physiological.fields.bloodPressure',
    );
    expect(fieldKey({ field: 'blood_pressure.diastolic_mmhg', issue: 'out_of_range' })).toBe(
      'profile.physiological.fields.diastolic',
    );
    expect(fieldKey({ field: 'consent.version', issue: 'required' })).toBe(
      'profile.physiological.fields.consent',
    );
    expect(fieldKey({ field: 'bmi', issue: 'field_not_allowed' })).toBe(
      'profile.issues.fieldRequest',
    );
    expect(fieldKey({ field: '', issue: 'required' })).toBe('profile.issues.fieldRequest');
  });
});
