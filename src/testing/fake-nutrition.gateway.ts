import { FOOD_CATALOG_RESPONSES, GET_NUTRITION_PLAN_RESPONSES } from './bff-web/nutrition.fixtures';
import {
  CreateNutritionPlanOutcome,
  NutritionPlan,
  NutritionPlanDraft,
  toFoodCatalog,
  toNutritionPlan,
} from '../app/features/training/nutrition/nutrition-plan.model';
import { NutritionGateway } from '../app/features/training/nutrition/nutrition.gateway';

/** Datos sintéticos de prueba, derivados del simulador del contrato. */
export const TEST_CATALOG = toFoodCatalog(FOOD_CATALOG_RESPONSES.ok.body);
export const TEST_PLAN: NutritionPlan = toNutritionPlan(GET_NUTRITION_PLAN_RESPONSES.found.body);
export const TEST_DRAFT: NutritionPlanDraft = {
  athleteEmail: 'deportista@example.com',
  title: TEST_PLAN.title,
  objectives: TEST_PLAN.objectives,
  startDate: TEST_PLAN.startDate,
  endDate: TEST_PLAN.endDate,
  meals: TEST_PLAN.meals,
};

/** Puerto controlado por las pruebas de componentes de HU014. */
export class FakeNutritionGateway extends NutritionGateway {
  loadCatalog = jasmine.createSpy('loadCatalog').and.resolveTo(TEST_CATALOG);
  createPlan = jasmine.createSpy('createPlan').and.resolveTo({
    kind: 'created',
    plan: TEST_PLAN,
    warnings: [],
    replayed: false,
  } satisfies CreateNutritionPlanOutcome);
  getPlan = jasmine.createSpy('getPlan').and.resolveTo(TEST_PLAN);
  loadMyPlans = jasmine
    .createSpy('loadMyPlans')
    .and.resolveTo({ plans: [TEST_PLAN], nextCursor: null });
}
