import { ApiError } from '../../../../core/api/api-error';
import {
  PublishRoutineRequestDto,
  RoutineAllergenDto,
  RoutineDietPatternDto,
  RoutineGoalDto,
  RoutineMealTypeDto,
  RoutineResponseDto,
  RoutineSportDto,
  RoutineStatusDto,
} from '../../../../core/api/bff-web/nutrition-routines.api';

/**
 * Modelo de pantalla de las rutinas de alimentación del profesional (HU030,
 * ADR-041). Transforma el transporte sin reglas del dominio: la validez de los
 * alimentos, su coherencia con el patrón, los alérgenos que aporta cada
 * alimento, la propiedad y la versión los decide el backend. Una rutina no es un
 * plan asignado (HU014): no tiene deportista ni fechas.
 */

export type RoutineSport = RoutineSportDto;
export type RoutineGoal = RoutineGoalDto;
export type RoutineDietPattern = RoutineDietPatternDto;
export type RoutineAllergen = RoutineAllergenDto;
export type RoutineMealType = RoutineMealTypeDto;
export type RoutineStatus = RoutineStatusDto;

export interface RoutineItem {
  /** Código del catálogo de alimentos de HU014. */
  readonly foodCode: string;
  readonly portions: number;
}

/** Comida del día tipo, en el orden del profesional. */
export interface RoutineMeal {
  readonly meal: RoutineMealType;
  readonly items: readonly RoutineItem[];
}

/** Rutina propia confirmada por el backend. */
export interface NutritionRoutine {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly goal: RoutineGoal;
  readonly sport: RoutineSport | null;
  readonly dietaryPattern: RoutineDietPattern;
  /** Los confirmados por el servicio (declarados más los de cada alimento), en su orden. */
  readonly containsAllergens: readonly RoutineAllergen[];
  /** Vigencia en días. */
  readonly durationDays: number;
  readonly dailyMeals: readonly RoutineMeal[];
  readonly status: RoutineStatus;
  readonly version: number;
  /** Instantes UTC (`Z`). */
  readonly publishedAt: string;
  readonly retiredAt: string | null;
}

/** Una página en el orden del backend (`created_at` y `template_id` descendentes). */
export interface RoutinesPage {
  readonly routines: readonly NutritionRoutine[];
  readonly nextCursor: string | null;
}

/** Rutina que captura el profesional, ya normalizada para el contrato. */
export interface RoutineDraft {
  readonly title: string;
  readonly description: string;
  readonly goal: RoutineGoal;
  readonly sport: RoutineSport | null;
  readonly dietaryPattern: RoutineDietPattern;
  readonly containsAllergens: readonly RoutineAllergen[];
  readonly durationDays: number;
  readonly dailyMeals: readonly RoutineMeal[];
}

/** Regla incumplida (`details[{field, issue}]`), sin el prefijo `body.`. */
export interface RoutineViolation {
  readonly field: string;
  readonly issue: string;
}

export type PublishOutcome =
  | {
      readonly kind: 'published';
      readonly routine: NutritionRoutine;
      readonly replayed: boolean;
    }
  | { readonly kind: 'invalid'; readonly violations: readonly RoutineViolation[] }
  | { readonly kind: 'failed'; readonly error: ApiError };

export type RetireOutcome =
  | { readonly kind: 'retired'; readonly routine: NutritionRoutine }
  /** `409 version_conflict`: `currentVersion` es la vigente, o `null` si no la trae. */
  | { readonly kind: 'conflict'; readonly currentVersion: number | null }
  | { readonly kind: 'failed'; readonly error: ApiError };

export function toNutritionRoutine(dto: RoutineResponseDto): NutritionRoutine {
  return {
    id: dto.template_id,
    title: dto.title,
    description: dto.description,
    goal: dto.goal,
    sport: dto.sport,
    dietaryPattern: dto.dietary_pattern,
    containsAllergens: [...dto.contains_allergens],
    durationDays: dto.duration_days,
    dailyMeals: dto.daily_meals.map((meal) => ({
      meal: meal.meal,
      items: meal.items.map((item) => ({ foodCode: item.food_code, portions: item.portions })),
    })),
    status: dto.status,
    version: dto.version,
    publishedAt: dto.published_at,
    retiredAt: dto.retired_at,
  };
}

/** Cuerpo de `POST /v1/nutrition-routine-templates`: sin `professional_id` ni campos adicionales. */
export function toPublishRoutineRequest(draft: RoutineDraft): PublishRoutineRequestDto {
  return {
    title: draft.title,
    description: draft.description,
    goal: draft.goal,
    sport: draft.sport,
    dietary_pattern: draft.dietaryPattern,
    contains_allergens: [...draft.containsAllergens],
    duration_days: draft.durationDays,
    daily_meals: draft.dailyMeals.map((meal) => ({
      meal: meal.meal,
      items: meal.items.map((item) => ({ food_code: item.foodCode, portions: item.portions })),
    })),
  };
}

/** Controles del formulario de la rutina que pueden recibir una regla del backend. */
export type RoutineControl =
  | 'title'
  | 'description'
  | 'goal'
  | 'sport'
  | 'dietaryPattern'
  | 'containsAllergens'
  | 'durationDays';

/** Controles de un alimento de una comida. */
export type ItemControl = 'foodCode' | 'portions';

/** Dónde se marca una regla de `POST /v1/nutrition-routine-templates` en el formulario. */
export type RoutineTarget =
  | { readonly kind: 'field'; readonly control: RoutineControl }
  /** Una comida (`daily_meals.1.meal`); `items` si la regla es de su lista de alimentos. */
  | { readonly kind: 'meal'; readonly meal: number; readonly control: 'meal' | 'items' | null }
  /** Un alimento (`daily_meals.0.items.1.food_code`); `control` es `null` si la regla es del alimento. */
  | {
      readonly kind: 'item';
      readonly meal: number;
      readonly item: number;
      readonly control: ItemControl | null;
    }
  /** La lista completa de comidas. */
  | { readonly kind: 'meals' }
  /** Sin control (`Idempotency-Key`, `professional_id` o sin campo): solo el resumen. */
  | { readonly kind: 'none' };

const FIELD_CONTROLS: Readonly<Record<string, RoutineControl>> = {
  title: 'title',
  description: 'description',
  goal: 'goal',
  sport: 'sport',
  dietary_pattern: 'dietaryPattern',
  contains_allergens: 'containsAllergens',
  duration_days: 'durationDays',
};

const ITEM_CONTROLS: Readonly<Record<string, ItemControl>> = {
  food_code: 'foodCode',
  portions: 'portions',
};

const INDEX = String.raw`(?:\.(\d+)|\[(\d+)\])`;

/**
 * El servicio informa el alimento como `daily_meals.0.items.1.food_code`
 * (ubicación de la validación); también se acepta `daily_meals[0].items[1].food_code`.
 */
const MEAL_PATH = new RegExp(String.raw`^daily_meals${INDEX}(?:\.(meal|items))?$`);
const ITEM_PATH = new RegExp(String.raw`^daily_meals${INDEX}\.items${INDEX}(?:\.([a-z_]+))?$`);
/** Un alérgeno concreto de la lista (`contains_allergens.2`) se marca en la lista. */
const ALLERGEN_PATH = new RegExp(String.raw`^contains_allergens${INDEX}$`);

/** Ubica la ruta de `details[].field` (sin `body.`) en el formulario. */
export function routineTarget(field: string): RoutineTarget {
  const item = ITEM_PATH.exec(field);
  if (item) {
    const name = item[5];
    if (name !== undefined && !Object.hasOwn(ITEM_CONTROLS, name)) {
      return { kind: 'none' };
    }
    return {
      kind: 'item',
      meal: Number(item[1] ?? item[2]),
      item: Number(item[3] ?? item[4]),
      control: name === undefined ? null : ITEM_CONTROLS[name],
    };
  }
  const meal = MEAL_PATH.exec(field);
  if (meal) {
    return {
      kind: 'meal',
      meal: Number(meal[1] ?? meal[2]),
      control: (meal[3] as 'meal' | 'items' | undefined) ?? null,
    };
  }
  if (field === 'daily_meals') {
    return { kind: 'meals' };
  }
  if (ALLERGEN_PATH.test(field)) {
    return { kind: 'field', control: 'containsAllergens' };
  }
  return Object.hasOwn(FIELD_CONTROLS, field)
    ? { kind: 'field', control: FIELD_CONTROLS[field] }
    : { kind: 'none' };
}

/**
 * Motivos que el cliente sabe explicar: los del servicio y los de la validación de
 * forma, agrupados por su significado. Otro motivo usa un texto genérico.
 */
const ISSUE_GROUPS: Readonly<Record<string, string>> = {
  missing: 'required',
  required: 'required',
  invalid_length: 'invalid_length',
  string_too_short: 'invalid_length',
  string_too_long: 'invalid_length',
  out_of_range: 'out_of_range',
  greater_than_equal: 'out_of_range',
  less_than_equal: 'out_of_range',
  too_short: 'out_of_range',
  too_long: 'out_of_range',
  enum: 'unknown_value',
  unknown_value: 'unknown_value',
  literal_error: 'unknown_value',
  int_type: 'not_integer',
  int_parsing: 'not_integer',
  duplicate_value: 'duplicate_value',
  conflicts_with_restriction: 'conflicts_with_restriction',
  extra_forbidden: 'field_not_allowed',
  field_not_allowed: 'field_not_allowed',
};

export function routineIssueKey(issue: string): string {
  const group = Object.hasOwn(ISSUE_GROUPS, issue) ? ISSUE_GROUPS[issue] : 'unknown';
  return `training.nutrition.routines.issues.${group}`;
}

/** Texto del campo afectado para el resumen («Comida 2, alimento 1 (porciones)»). */
export function routineFieldText(field: string): {
  readonly key: string;
  readonly params: Readonly<Record<string, unknown>>;
} {
  const target = routineTarget(field);
  const base = 'training.nutrition.routines';
  switch (target.kind) {
    case 'field':
      return { key: `${base}.fields.${target.control}`, params: {} };
    case 'meal':
      return {
        key: `${base}.violationFields.${target.control === 'items' ? 'mealItems' : 'meal'}`,
        params: { n: target.meal + 1 },
      };
    case 'item':
      return {
        key: `${base}.violationFields.item${target.control === null ? '' : capitalize(target.control)}`,
        params: { meal: target.meal + 1, n: target.item + 1 },
      };
    case 'meals':
      return { key: `${base}.fields.dailyMeals`, params: {} };
    case 'none':
      return { key: `${base}.violationFields.request`, params: {} };
  }
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Total de alimentos del día tipo, para el resumen de la rutina. */
export function itemsCount(meals: readonly RoutineMeal[]): number {
  return meals.reduce((total, meal) => total + meal.items.length, 0);
}
