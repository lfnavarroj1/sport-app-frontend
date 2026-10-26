import { NUTRITION_PLAN_ISSUES } from '../../../../core/api/bff-web/nutrition.api';
import { ruleText, violationMessage, violationTarget } from './nutrition-violations';

describe('Rechazos del plan de alimentación (HU014)', () => {
  it('ubica los campos del plan, los objetivos y el tipo de comida', () => {
    expect(violationTarget('athlete_email')).toEqual({ control: 'athleteEmail' });
    expect(violationTarget('end_date')).toEqual({ control: 'endDate' });
    expect(violationTarget('objectives.2')).toEqual({ control: 'objective', index: 2 });
    expect(violationTarget('meals.1.meal_type')).toEqual({ control: 'mealType', meal: 1 });
  });

  it('ubica cada campo de un ítem; un ítem sin campo se marca en su alimento (CA2)', () => {
    expect(violationTarget('meals.0.items.1.food_code')).toEqual({
      control: 'item',
      meal: 0,
      item: 1,
      field: 'foodCode',
    });
    expect(violationTarget('meals.2.items.0.quantity')).toEqual({
      control: 'item',
      meal: 2,
      item: 0,
      field: 'quantity',
    });
    expect(violationTarget('meals.0.items.3.unit')).toEqual({
      control: 'item',
      meal: 0,
      item: 3,
      field: 'unit',
    });
    expect(violationTarget('meals.0.items.4')).toEqual({
      control: 'item',
      meal: 0,
      item: 4,
      field: 'foodCode',
    });
  });

  it('las listas completas y las rutas desconocidas solo van al resumen', () => {
    for (const path of ['', 'meals', 'meals.0.items', 'objectives', 'meals.x', 'otro', 'title.0']) {
      expect(violationTarget(path)).toEqual({ control: null });
    }
    expect(violationTarget('meals.0.items.1.food_code.extra')).toEqual({ control: null });
  });

  it('presenta el ítem bloqueado con su posición desde 1 y la causa', () => {
    expect(
      violationMessage({ path: 'meals.0.items.1.food_code', issue: 'conflicts_with_allergy' }),
    ).toEqual({
      field: { key: 'training.nutrition.rules.fieldItem.foodCode', params: { meal: 1, item: 2 } },
      rule: { key: 'training.nutrition.rules.conflicts_with_allergy', params: {} },
    });
    expect(violationMessage({ path: 'meals.1.meal_type', issue: 'unknown_value' }).field).toEqual({
      key: 'training.nutrition.rules.fieldMealType',
      params: { n: 2 },
    });
    expect(violationMessage({ path: 'objectives.0', issue: 'out_of_range' }).field).toEqual({
      key: 'training.nutrition.rules.fieldObjective',
      params: { n: 1 },
    });
    expect(violationMessage({ path: 'meals.2.items', issue: 'out_of_range' }).field).toEqual({
      key: 'training.nutrition.rules.fieldMealItems',
      params: { n: 3 },
    });
    expect(violationMessage({ path: 'meals', issue: 'out_of_range' }).field.key).toBe(
      'training.nutrition.fields.meals',
    );
    expect(violationMessage({ path: '', issue: 'out_of_range' }).field.key).toBe(
      'training.nutrition.rules.fieldPlan',
    );
    expect(violationMessage({ path: 'end_date', issue: 'period_too_long' }).field.key).toBe(
      'training.nutrition.fields.endDate',
    );
  });

  it('conoce todos los motivos del contrato; uno desconocido se informa de forma genérica', () => {
    for (const issue of NUTRITION_PLAN_ISSUES) {
      expect(ruleText(issue).key).toBe(`training.nutrition.rules.${issue}`);
    }
    expect(ruleText('string_pattern_mismatch').key).toBe('training.nutrition.rules.unknown');
  });
});
