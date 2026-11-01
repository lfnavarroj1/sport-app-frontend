import { FOOD_INTAKES_RESPONSES } from './bff-web/food-intakes.fixtures';
import { FoodIntakesGateway } from '../app/features/training/nutrition/intake-history/food-intakes.gateway';
import {
  FoodIntakesPage,
  toFoodIntakesPage,
} from '../app/features/training/nutrition/intake-history/food-intakes.model';

/** Datos sintéticos de prueba, derivados del simulador del contrato. */
export const TEST_INTAKES_FIRST_PAGE: FoodIntakesPage = toFoodIntakesPage(
  FOOD_INTAKES_RESPONSES.firstPage.body,
);
export const TEST_INTAKES_LAST_PAGE: FoodIntakesPage = toFoodIntakesPage(
  FOOD_INTAKES_RESPONSES.lastPage.body,
);
export const TEST_INTAKES_EMPTY: FoodIntakesPage = { intakes: [], nextCursor: null };

/** Puerto controlado por las pruebas de componentes de HU013. */
export class FakeFoodIntakesGateway extends FoodIntakesGateway {
  loadPage = jasmine.createSpy('loadPage').and.resolveTo(TEST_INTAKES_LAST_PAGE);
}
