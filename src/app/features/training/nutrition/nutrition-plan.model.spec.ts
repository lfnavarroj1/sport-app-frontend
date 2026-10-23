import {
  FOOD_CATALOG_RESPONSES,
  GET_NUTRITION_PLAN_RESPONSES,
} from '../../../../testing/bff-web/nutrition.fixtures';
import {
  foodLabelKey,
  foodsByCategory,
  toFoodCatalog,
  toNutritionPlan,
} from './nutrition-plan.model';

describe('Modelo de planes de alimentación (HU014)', () => {
  const catalog = toFoodCatalog(FOOD_CATALOG_RESPONSES.ok.body);

  it('transforma el catálogo sin copiar alérgenos ni incompatibilidades', () => {
    expect(catalog.version).toBe('food-catalog-2026-10-13.v1');
    expect(catalog.foods[0]).toEqual({
      code: 'OATS',
      labelKey: 'food.oats',
      category: 'GRAIN',
      defaultUnit: 'G',
      allowedUnits: ['G', 'CUP', 'TBSP'],
    });
    expect(Object.keys(catalog.foods[0])).not.toContain('allergens');
  });

  it('agrupa los alimentos por categoría en el orden del contrato y omite las vacías', () => {
    expect(foodsByCategory(catalog).map((group) => group.category)).toEqual([
      'GRAIN',
      'PROTEIN',
      'DAIRY',
      'FRUIT',
      'FAT',
      'BEVERAGE',
    ]);
    expect(foodsByCategory(catalog)[1].foods.map((food) => food.code)).toEqual([
      'CHICKEN_BREAST',
      'EGG',
    ]);
  });

  it('resuelve la clave del nombre desde el catálogo; sin catálogo o código desconocido, null', () => {
    expect(foodLabelKey(catalog, 'PEANUT_BUTTER')).toBe('food.peanut_butter');
    expect(foodLabelKey(catalog, 'NO_EXISTE')).toBeNull();
    expect(foodLabelKey(null, 'OATS')).toBeNull();
  });

  it('transforma el plan confirmado conservando las cantidades como cadena decimal', () => {
    const plan = toNutritionPlan(GET_NUTRITION_PLAN_RESPONSES.found.body);

    expect(plan.id).toBe(GET_NUTRITION_PLAN_RESPONSES.found.body.plan_id);
    expect(plan.status).toBe('ASSIGNED');
    expect(plan.version).toBe(1);
    expect(plan.catalogVersion).toBe('food-catalog-2026-10-13.v1');
    expect(plan.meals).toEqual([
      {
        mealType: 'BREAKFAST',
        items: [
          { foodCode: 'OATS', quantity: '60.0', unit: 'G' },
          { foodCode: 'PEANUT_BUTTER', quantity: '1.5', unit: 'TBSP' },
        ],
      },
      { mealType: 'HYDRATION', items: [{ foodCode: 'WATER', quantity: '500.0', unit: 'ML' }] },
    ]);
  });
});
