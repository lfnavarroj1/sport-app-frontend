import { NUTRITION_RULE_ISSUES, NutritionPlanViolation } from '../nutrition-plan.model';

export interface TranslatedText {
  readonly key: string;
  readonly params: Readonly<Record<string, unknown>>;
}

/** Texto localizable de una regla incumplida: campo afectado y motivo. */
export interface ViolationMessage {
  readonly field: TranslatedText;
  readonly rule: TranslatedText;
}

export type PlanControl = 'athleteEmail' | 'title' | 'startDate' | 'endDate';
export type ItemField = 'foodCode' | 'quantity' | 'unit';

/** Ubicación de una regla incumplida en el formulario del editor. */
export type ViolationTarget =
  | { readonly control: PlanControl }
  | { readonly control: 'objective'; readonly index: number }
  | { readonly control: 'mealType'; readonly meal: number }
  | {
      readonly control: 'item';
      readonly meal: number;
      readonly item: number;
      readonly field: ItemField;
    }
  | { readonly control: null };

const PLAN_FIELDS: Readonly<Record<string, PlanControl>> = {
  athlete_email: 'athleteEmail',
  title: 'title',
  start_date: 'startDate',
  end_date: 'endDate',
};

const ITEM_FIELDS: Readonly<Record<string, ItemField>> = {
  food_code: 'foodCode',
  quantity: 'quantity',
  unit: 'unit',
};

const isIndex = (value: string | undefined): boolean => value !== undefined && /^\d+$/.test(value);

/**
 * Control del formulario al que corresponde la ruta informada por el backend
 * (`meals.0.items.1.food_code`). Un ítem sin campo se marca en su alimento; las
 * listas completas (`meals`, `meals.0.items`) solo se informan en el resumen.
 */
export function violationTarget(path: string): ViolationTarget {
  const parts = path.split('.');
  const [head, first, second, third, field, ...rest] = parts;
  if (PLAN_FIELDS[head] && parts.length === 1) {
    return { control: PLAN_FIELDS[head] };
  }
  if (head === 'objectives' && isIndex(first) && parts.length === 2) {
    return { control: 'objective', index: Number(first) };
  }
  if (head !== 'meals' || !isIndex(first) || rest.length > 0) {
    return { control: null };
  }
  const meal = Number(first);
  if (second === 'meal_type' && parts.length === 3) {
    return { control: 'mealType', meal };
  }
  if (second === 'items' && isIndex(third)) {
    const item = Number(third);
    if (field === undefined) {
      return { control: 'item', meal, item, field: 'foodCode' };
    }
    if (ITEM_FIELDS[field]) {
      return { control: 'item', meal, item, field: ITEM_FIELDS[field] };
    }
  }
  return { control: null };
}

/** Claves i18n para presentar la regla; las posiciones se muestran desde 1. */
export function violationMessage(violation: NutritionPlanViolation): ViolationMessage {
  return { field: fieldText(violation.path), rule: ruleText(violation.issue) };
}

/** Un motivo que el cliente no conoce se informa con un texto genérico. */
export function ruleText(issue: string): TranslatedText {
  const known = NUTRITION_RULE_ISSUES.includes(issue);
  return { key: `training.nutrition.rules.${known ? issue : 'unknown'}`, params: {} };
}

function fieldText(path: string): TranslatedText {
  const target = violationTarget(path);
  switch (target.control) {
    case 'objective':
      return { key: 'training.nutrition.rules.fieldObjective', params: { n: target.index + 1 } };
    case 'mealType':
      return { key: 'training.nutrition.rules.fieldMealType', params: { n: target.meal + 1 } };
    case 'item':
      return {
        key: `training.nutrition.rules.fieldItem.${target.field}`,
        params: { meal: target.meal + 1, item: target.item + 1 },
      };
    case null:
      return listText(path);
    default:
      return { key: `training.nutrition.fields.${target.control}`, params: {} };
  }
}

/** Listas completas: objetivos, comidas o alimentos de una comida. */
function listText(path: string): TranslatedText {
  const [head, meal, items] = path.split('.');
  if (head === 'objectives' || (head === 'meals' && meal === undefined)) {
    return { key: `training.nutrition.fields.${head}`, params: {} };
  }
  if (head === 'meals' && isIndex(meal) && items === 'items') {
    return { key: 'training.nutrition.rules.fieldMealItems', params: { n: Number(meal) + 1 } };
  }
  return { key: 'training.nutrition.rules.fieldPlan', params: {} };
}
