import es from '../../../../../../public/i18n/es.json';
import {
  VALID_PUBLISH_ROUTINE_REQUEST,
  VALID_ROUTINE_CONFIRMED_ALLERGENS,
  professionalRoutine,
} from '../../../../../testing/bff-web/nutrition-routines.fixtures';
import {
  PUBLISH_ROUTINE_ISSUES,
  ROUTINE_ALLERGENS,
  ROUTINE_DIET_PATTERNS,
  ROUTINE_GOALS,
  ROUTINE_MEAL_TYPES,
  ROUTINE_STATUSES,
} from '../../../../core/api/bff-web/nutrition-routines.api';
import {
  RoutineDraft,
  itemsCount,
  routineFieldText,
  routineIssueKey,
  routineTarget,
  toNutritionRoutine,
  toPublishRoutineRequest,
} from './routines.model';

const MEALS = VALID_PUBLISH_ROUTINE_REQUEST.daily_meals.map((meal) => ({
  meal: meal.meal,
  items: meal.items.map((item) => ({ foodCode: item.food_code, portions: item.portions })),
}));

const DRAFT: RoutineDraft = {
  title: VALID_PUBLISH_ROUTINE_REQUEST.title,
  description: VALID_PUBLISH_ROUTINE_REQUEST.description,
  goal: 'PERFORMANCE',
  sport: 'running',
  dietaryPattern: 'VEGETARIAN',
  containsAllergens: ['MILK'],
  durationDays: 14,
  dailyMeals: MEALS,
};

function translate(key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => {
    return typeof node === 'object' && node !== null
      ? (node as Record<string, unknown>)[part]
      : undefined;
  }, es);
}

describe('Modelo de rutinas de alimentación (HU030)', () => {
  it('el cuerpo de publicar tiene exactamente los campos del contrato, sin professional_id', () => {
    expect(toPublishRoutineRequest(DRAFT)).toEqual(VALID_PUBLISH_ROUTINE_REQUEST);
  });

  it('CA2: los alérgenos declarados viajan tal cual; sin deporte se envía null', () => {
    const body = toPublishRoutineRequest({ ...DRAFT, sport: null, containsAllergens: [] });

    expect(body.sport).toBeNull();
    expect(body.contains_allergens).toEqual([]);
  });

  it('CA4: transforma la rutina confirmada con alérgenos del servicio, estado, versión y comidas en orden', () => {
    expect(toNutritionRoutine(professionalRoutine(0))).toEqual({
      id: professionalRoutine(0).template_id,
      title: VALID_PUBLISH_ROUTINE_REQUEST.title,
      description: VALID_PUBLISH_ROUTINE_REQUEST.description,
      goal: 'PERFORMANCE',
      sport: 'running',
      dietaryPattern: 'VEGETARIAN',
      containsAllergens: [...VALID_ROUTINE_CONFIRMED_ALLERGENS],
      durationDays: 14,
      dailyMeals: MEALS,
      status: 'PUBLISHED',
      version: 1,
      publishedAt: '2026-10-25T15:00:00Z',
      retiredAt: null,
    });
    expect(toNutritionRoutine(professionalRoutine(1, 'RETIRED'))).toEqual(
      jasmine.objectContaining({ status: 'RETIRED', version: 2, sport: null }),
    );
  });

  it('ubica cada ruta de details en su campo, comida o alimento', () => {
    expect(routineTarget('title')).toEqual({ kind: 'field', control: 'title' });
    expect(routineTarget('dietary_pattern')).toEqual({
      kind: 'field',
      control: 'dietaryPattern',
    });
    expect(routineTarget('contains_allergens')).toEqual({
      kind: 'field',
      control: 'containsAllergens',
    });
    expect(routineTarget('contains_allergens.2')).toEqual({
      kind: 'field',
      control: 'containsAllergens',
    });
    expect(routineTarget('duration_days')).toEqual({ kind: 'field', control: 'durationDays' });
    expect(routineTarget('daily_meals')).toEqual({ kind: 'meals' });
    expect(routineTarget('daily_meals.1')).toEqual({ kind: 'meal', meal: 1, control: null });
    expect(routineTarget('daily_meals.1.meal')).toEqual({ kind: 'meal', meal: 1, control: 'meal' });
    expect(routineTarget('daily_meals[0].items')).toEqual({
      kind: 'meal',
      meal: 0,
      control: 'items',
    });
    expect(routineTarget('daily_meals.0.items.1.food_code')).toEqual({
      kind: 'item',
      meal: 0,
      item: 1,
      control: 'foodCode',
    });
    expect(routineTarget('daily_meals[2].items[3].portions')).toEqual({
      kind: 'item',
      meal: 2,
      item: 3,
      control: 'portions',
    });
    expect(routineTarget('daily_meals.0.items.1')).toEqual({
      kind: 'item',
      meal: 0,
      item: 1,
      control: null,
    });
    expect(routineTarget('daily_meals.0.items.1.unit')).toEqual({ kind: 'none' });
    expect(routineTarget('professional_id')).toEqual({ kind: 'none' });
    expect(routineTarget('')).toEqual({ kind: 'none' });
  });

  it('CA4: el alimento inexistente o incompatible con el patrón tiene su texto', () => {
    expect(routineIssueKey('unknown_value')).toBe(
      'training.nutrition.routines.issues.unknown_value',
    );
    expect(routineIssueKey('conflicts_with_restriction')).toBe(
      'training.nutrition.routines.issues.conflicts_with_restriction',
    );
    expect(routineIssueKey('duplicate_value')).toBe(
      'training.nutrition.routines.issues.duplicate_value',
    );
    expect(routineIssueKey('less_than_equal')).toBe(
      'training.nutrition.routines.issues.out_of_range',
    );
    expect(routineIssueKey('otro_motivo')).toBe('training.nutrition.routines.issues.unknown');
  });

  it('describe el campo afectado con su posición humana', () => {
    expect(routineFieldText('daily_meals.0.items.1.food_code')).toEqual({
      key: 'training.nutrition.routines.violationFields.itemFoodCode',
      params: { meal: 1, n: 2 },
    });
    expect(routineFieldText('daily_meals.1.items')).toEqual({
      key: 'training.nutrition.routines.violationFields.mealItems',
      params: { n: 2 },
    });
    expect(routineFieldText('daily_meals.1.meal')).toEqual({
      key: 'training.nutrition.routines.violationFields.meal',
      params: { n: 2 },
    });
    expect(routineFieldText('daily_meals')).toEqual({
      key: 'training.nutrition.routines.fields.dailyMeals',
      params: {},
    });
    expect(routineFieldText('x')).toEqual({
      key: 'training.nutrition.routines.violationFields.request',
      params: {},
    });
  });

  it('cuenta los alimentos del día tipo', () => {
    expect(itemsCount(MEALS)).toBe(3);
  });

  it('todos los textos del modelo y de los catálogos existen en es.json', () => {
    const keys = [
      ...['unknown', 'required', 'invalid_length', 'out_of_range', 'not_integer'].map(
        (issue) => `training.nutrition.routines.issues.${issue}`,
      ),
      ...['field_not_allowed', 'item'].map(
        (issue) => `training.nutrition.routines.issues.${issue}`,
      ),
      ...PUBLISH_ROUTINE_ISSUES.map((issue) => routineIssueKey(issue)),
      ...[
        'title',
        'description',
        'goal',
        'sport',
        'dietaryPattern',
        'containsAllergens',
        'durationDays',
        'dailyMeals',
      ].map((field) => `training.nutrition.routines.fields.${field}`),
      ...['meal', 'mealItems', 'item', 'itemFoodCode', 'itemPortions', 'request'].map(
        (field) => `training.nutrition.routines.violationFields.${field}`,
      ),
      ...ROUTINE_GOALS.map((goal) => `training.templates.goals.${goal}`),
      ...ROUTINE_DIET_PATTERNS.map((pattern) => `profile.nutrition.patterns.${pattern}`),
      ...ROUTINE_ALLERGENS.map((allergen) => `profile.nutrition.allergies.${allergen}`),
      ...ROUTINE_MEAL_TYPES.map((meal) => `training.nutrition.mealTypes.${meal}`),
      ...ROUTINE_STATUSES.map((status) => `training.nutrition.routines.status.${status}`),
    ];
    for (const key of keys) {
      expect(typeof translate(key))
        .withContext(key)
        .toBe('string');
    }
  });
});
