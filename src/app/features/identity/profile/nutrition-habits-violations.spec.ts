import es from '../../../../../public/i18n/es.json';
import {
  nutritionHabitsControl,
  nutritionHabitsFieldKey,
  nutritionHabitsIssueKey,
} from './nutrition-habits-violations';

function translate(key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => {
    return typeof node === 'object' && node !== null
      ? (node as Record<string, unknown>)[part]
      : undefined;
  }, es);
}

describe('Reglas de los hábitos alimenticios (HU009)', () => {
  it('ubica cada campo del contrato en su control, también las posiciones de las listas', () => {
    expect(nutritionHabitsControl('diet_pattern')).toBe('dietPattern');
    expect(nutritionHabitsControl('restrictions')).toBe('restrictions');
    expect(nutritionHabitsControl('restrictions[3]')).toBe('restrictions');
    expect(nutritionHabitsControl('allergies')).toBe('allergies');
    expect(nutritionHabitsControl('allergies[1]')).toBe('allergies');
    expect(nutritionHabitsControl('meals_per_day')).toBe('mealsPerDay');
    expect(nutritionHabitsControl('hydration_liters_per_day')).toBe('hydration');
    expect(nutritionHabitsControl('consent')).toBe('consent');
    expect(nutritionHabitsControl('consent.version')).toBe('consent');
  });

  it('los campos sin control solo van al resumen', () => {
    for (const field of ['user_id', 'Idempotency-Key', 'expected_version', '', 'allergies.x']) {
      expect(nutritionHabitsControl(field)).withContext(field).toBeNull();
      expect(nutritionHabitsFieldKey({ field, issue: 'required' })).toBe(
        'profile.issues.fieldRequest',
      );
    }
  });

  it('el consentimiento explica qué hacer; los demás motivos usan el catálogo común', () => {
    expect(nutritionHabitsIssueKey({ field: 'consent.version', issue: 'required' })).toBe(
      'profile.nutrition.consent.issues.required',
    );
    expect(
      nutritionHabitsIssueKey({ field: 'consent', issue: 'unsupported_consent_version' }),
    ).toBe('profile.nutrition.consent.issues.unsupported_consent_version');
    expect(nutritionHabitsIssueKey({ field: 'allergies[1]', issue: 'duplicate_value' })).toBe(
      'profile.issues.duplicate_value',
    );
    expect(nutritionHabitsIssueKey({ field: 'meals_per_day', issue: 'motivo_nuevo' })).toBe(
      'profile.issues.unknown',
    );
    // El texto común de `inconsistent_values` habla de la presión arterial.
    expect(nutritionHabitsIssueKey({ field: 'diet_pattern', issue: 'inconsistent_values' })).toBe(
      'profile.issues.unknown',
    );
  });

  it('cada clave que puede producir tiene texto en es.json', () => {
    const fields = [
      'diet_pattern',
      'restrictions',
      'allergies',
      'meals_per_day',
      'hydration_liters_per_day',
      'consent.version',
      'user_id',
    ];
    const issues = ['required', 'unsupported_consent_version', 'duplicate_value', 'otro'];
    for (const field of fields) {
      for (const issue of issues) {
        for (const key of [
          nutritionHabitsFieldKey({ field, issue }),
          nutritionHabitsIssueKey({ field, issue }),
        ]) {
          expect(typeof translate(key))
            .withContext(key)
            .toBe('string');
        }
      }
    }
  });
});
