import { FOOD_INTAKES_RESPONSES } from '../../../../../testing/bff-web/food-intakes.fixtures';
import { TEST_CATALOG } from '../../../../../testing/fake-nutrition.gateway';
import {
  FoodIntake,
  NO_INTAKE_FILTERS,
  foodLabelKey,
  groupByDay,
  hasIntakeFilters,
  periodIsInverted,
  toFoodIntakesPage,
} from './food-intakes.model';

const intake = (id: string, consumedAt: string, mealType: FoodIntake['mealType']): FoodIntake => ({
  id,
  consumedAt,
  mealType,
  items: [{ foodCode: 'WATER', quantity: 500, unit: 'ML' }],
});

describe('Modelo del historial de alimentación (HU013)', () => {
  it('transforma la página del contrato sin reordenarla y convierte la cantidad a número', () => {
    const page = toFoodIntakesPage(FOOD_INTAKES_RESPONSES.firstPage.body);

    expect(page.intakes.map((item) => item.id)).toEqual(
      FOOD_INTAKES_RESPONSES.firstPage.body.items.map((item) => item.intake_id),
    );
    expect(page.intakes[3].items).toEqual([
      { foodCode: 'OATS', quantity: 60, unit: 'G' },
      { foodCode: 'PEANUT_BUTTER', quantity: 1.5, unit: 'TBSP' },
      { foodCode: 'MILK', quantity: 1, unit: 'CUP' },
    ]);
    expect(page.nextCursor).toBe(FOOD_INTAKES_RESPONSES.firstPage.body.next_cursor);
    // Solo lo que se muestra: ni el deportista ni la versión pasan a la vista.
    expect(Object.keys(page.intakes[0]).sort()).toEqual(['consumedAt', 'id', 'items', 'mealType']);
  });

  it('agrupa por día de la zona indicada y por comida, en el orden del backend', () => {
    const intakes = [
      intake('a', '2026-10-24T23:15:00Z', 'DINNER'),
      intake('b', '2026-10-24T19:15:00Z', 'HYDRATION'),
      intake('c', '2026-10-24T17:15:00Z', 'HYDRATION'),
      intake('d', '2026-10-24T03:00:00Z', 'SNACK'),
    ];

    const bogota = groupByDay(intakes, 'America/Bogota');
    expect(bogota.map((day) => day.day)).toEqual(['2026-10-24', '2026-10-23']);
    expect(bogota[0].meals.map((meal) => [meal.mealType, meal.intakes.map((i) => i.id)])).toEqual([
      ['DINNER', ['a']],
      ['HYDRATION', ['b', 'c']],
    ]);
    // 03:00 UTC del 24 es todavía el 23 en Bogotá (UTC−5).
    expect(bogota[1].meals[0].intakes.map((i) => i.id)).toEqual(['d']);
    expect(bogota[1].anchor).toBe('2026-10-24T03:00:00Z');

    const utc = groupByDay(intakes, 'UTC');
    expect(utc.map((day) => day.day)).toEqual(['2026-10-24']);
  });

  it('una página siguiente continúa el mismo día sin duplicar el grupo', () => {
    const days = groupByDay(
      [
        intake('a', '2026-10-24T18:00:00Z', 'LUNCH'),
        intake('b', '2026-10-24T17:00:00Z', 'LUNCH'),
        intake('c', '2026-10-24T13:00:00Z', 'BREAKFAST'),
      ],
      'UTC',
    );

    expect(days.length).toBe(1);
    expect(days[0].meals.map((meal) => meal.intakes.length)).toEqual([2, 1]);
  });

  it('el periodo invertido se detecta solo con ambas fechas', () => {
    expect(periodIsInverted({ from: '2026-10-24', to: '2026-10-01', mealType: null })).toBeTrue();
    expect(periodIsInverted({ from: '2026-10-01', to: '2026-10-01', mealType: null })).toBeFalse();
    expect(periodIsInverted({ from: '2026-10-24', to: null, mealType: null })).toBeFalse();
    expect(periodIsInverted(NO_INTAKE_FILTERS)).toBeFalse();
  });

  it('reconoce cuándo hay filtros aplicados', () => {
    expect(hasIntakeFilters(NO_INTAKE_FILTERS)).toBeFalse();
    expect(hasIntakeFilters({ ...NO_INTAKE_FILTERS, mealType: 'SNACK' })).toBeTrue();
    expect(hasIntakeFilters({ ...NO_INTAKE_FILTERS, to: '2026-10-24' })).toBeTrue();
  });

  it('resuelve el nombre desde el catálogo y deja sin clave un código desconocido', () => {
    expect(foodLabelKey(TEST_CATALOG, 'OATS')).toBe('food.oats');
    expect(foodLabelKey(TEST_CATALOG, 'COFFEE')).toBeNull();
    expect(foodLabelKey(null, 'OATS')).toBeNull();
  });
});
