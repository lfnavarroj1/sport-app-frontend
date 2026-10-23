import { ApiError } from '../../../core/api/api-error';
import {
  FOOD_CATEGORIES,
  FOOD_UNITS,
  FoodCatalogResponseDto,
  MEAL_TYPES,
  NUTRITION_HABITS_MISSING,
  NUTRITION_PLAN_ISSUES,
  NutritionPlanResponseDto,
} from '../../../core/api/bff-web/nutrition.api';

/** Unidad de una cantidad; catálogo cerrado del contrato (`FoodUnit`). */
export type FoodUnit = (typeof FOOD_UNITS)[number];
/** Categoría de un alimento (`FoodCategory`), para agrupar el catálogo. */
export type FoodCategory = (typeof FOOD_CATEGORIES)[number];
/** Tipo de comida del menú diario (`MealType`). */
export type MealType = (typeof MEAL_TYPES)[number];

export const MEAL_TYPE_OPTIONS: readonly MealType[] = MEAL_TYPES;
export const FOOD_CATEGORY_ORDER: readonly FoodCategory[] = FOOD_CATEGORIES;

/**
 * Alimento del catálogo cerrado (ADR-037). Los alérgenos e incompatibilidades no
 * se copian: el bloqueo lo decide el backend con las restricciones del deportista.
 */
export interface FoodOption {
  readonly code: string;
  /** Clave i18n del nombre (`label_key`). */
  readonly labelKey: string;
  readonly category: FoodCategory;
  readonly defaultUnit: FoodUnit;
  readonly allowedUnits: readonly FoodUnit[];
}

export interface FoodCatalog {
  readonly version: string;
  readonly foods: readonly FoodOption[];
}

export function toFoodCatalog(dto: FoodCatalogResponseDto): FoodCatalog {
  return {
    version: dto.catalog_version,
    foods: dto.items.map((item) => ({
      code: item.food_code,
      labelKey: item.label_key,
      category: item.category,
      defaultUnit: item.default_unit,
      allowedUnits: [...item.allowed_units],
    })),
  };
}

/** Alimentos del catálogo agrupados por categoría, en el orden del contrato. */
export function foodsByCategory(
  catalog: FoodCatalog,
): readonly { readonly category: FoodCategory; readonly foods: readonly FoodOption[] }[] {
  return FOOD_CATEGORY_ORDER.map((category) => ({
    category,
    foods: catalog.foods.filter((item) => item.category === category),
  })).filter((group) => group.foods.length > 0);
}

/** Clave i18n del nombre de un alimento o `null` si el catálogo no lo incluye. */
export function foodLabelKey(catalog: FoodCatalog | null, code: string): string | null {
  return catalog?.foods.find((item) => item.code === code)?.labelKey ?? null;
}

export interface NutritionPlanItem {
  readonly foodCode: string;
  /** Cadena decimal tal como la confirma el backend (por ejemplo `150.0`). */
  readonly quantity: string;
  readonly unit: FoodUnit;
}

export interface NutritionPlanMeal {
  readonly mealType: MealType;
  readonly items: readonly NutritionPlanItem[];
}

/**
 * Plan de alimentación confirmado por el backend (HU014 CA1 y CA4): versión 1,
 * inmutable. Solo lleva identificadores del deportista y del creador.
 */
export interface NutritionPlan {
  readonly id: string;
  readonly athleteId: string;
  readonly professionalId: string;
  readonly title: string;
  readonly objectives: readonly string[];
  /** Periodo del plan: fechas calendario `YYYY-MM-DD`. */
  readonly startDate: string;
  readonly endDate: string;
  readonly status: 'ASSIGNED';
  readonly version: number;
  readonly catalogVersion: string;
  /** Menú diario del periodo, en el orden del profesional. */
  readonly meals: readonly NutritionPlanMeal[];
  /** Instante ISO 8601 de creación. */
  readonly createdAt: string;
}

export function toNutritionPlan(dto: NutritionPlanResponseDto): NutritionPlan {
  return {
    id: dto.plan_id,
    athleteId: dto.athlete_id,
    professionalId: dto.professional_id,
    title: dto.title,
    objectives: [...dto.objectives],
    startDate: dto.start_date,
    endDate: dto.end_date,
    status: dto.status,
    version: dto.version,
    catalogVersion: dto.catalog_version,
    meals: dto.meals.map((meal) => ({
      mealType: meal.meal_type,
      items: meal.items.map((item) => ({
        foodCode: item.food_code,
        quantity: item.quantity,
        unit: item.unit,
      })),
    })),
    createdAt: dto.created_at,
  };
}

/** Datos que el profesional captura en el editor (HU014). */
export interface NutritionPlanDraft {
  /** Correo exacto del deportista: el BFF lo resuelve; no hay búsqueda parcial. */
  readonly athleteEmail: string;
  readonly title: string;
  readonly objectives: readonly string[];
  readonly startDate: string;
  readonly endDate: string;
  readonly meals: readonly NutritionPlanMeal[];
}

/**
 * Regla incumplida que informa el backend (`nutrition_plan_invalid` o
 * `validation_error`). `path` es la ruta del campo sin el prefijo `body.`
 * (`end_date`, `meals.0.items.1.food_code`); vacía si no indica el campo.
 */
export interface NutritionPlanViolation {
  readonly path: string;
  readonly issue: string;
}

/** Motivos estables que el cliente sabe explicar (contrato bff-web 0.18.0). */
export const NUTRITION_RULE_ISSUES: readonly string[] = NUTRITION_PLAN_ISSUES;

/** Aviso del backend al crear el plan. */
export type NutritionPlanWarning = typeof NUTRITION_HABITS_MISSING;

/** Resultado del comando de creación, ya traducido desde el contrato. */
export type CreateNutritionPlanOutcome =
  | {
      readonly kind: 'created';
      readonly plan: NutritionPlan;
      readonly warnings: readonly NutritionPlanWarning[];
      readonly replayed: boolean;
    }
  | { readonly kind: 'invalid'; readonly violations: readonly NutritionPlanViolation[] }
  /** Correo inexistente, de otro actor o sin autorización vigente: el BFF no los distingue. */
  | { readonly kind: 'athlete_not_authorized' }
  | { readonly kind: 'failed'; readonly error: ApiError };

/** Una página de planes propios, en el orden del backend (`created_at` desc). */
export interface NutritionPlansPage {
  readonly plans: readonly NutritionPlan[];
  /** Cursor opaco de la página siguiente; `null` si no hay más. */
  readonly nextCursor: string | null;
}
