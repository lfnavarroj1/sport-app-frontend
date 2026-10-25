import { FoodIntakesPageDto } from '../../../../core/api/bff-web/food-intakes.api';
import { FoodCatalog, FoodUnit, MealType } from '../nutrition-plan.model';

/** De quién son los consumos que se consultan (HU013). */
export type IntakeScope =
  | { readonly kind: 'own' }
  /** Deportista que autorizó al profesional de la sesión (relación vigente, CA3). */
  | { readonly kind: 'athlete'; readonly athleteId: string };

/** Filtros del historial; `null` significa sin filtro. */
export interface IntakeFilters {
  /** Primer día inclusivo `YYYY-MM-DD` (día UTC del consumo, como el contrato). */
  readonly from: string | null;
  /** Último día inclusivo `YYYY-MM-DD` (UTC); no anterior a `from`. */
  readonly to: string | null;
  readonly mealType: MealType | null;
}

export const NO_INTAKE_FILTERS: IntakeFilters = { from: null, to: null, mealType: null };

/** Alimento de un consumo: código del catálogo, cantidad y unidad. Sin nutrientes. */
export interface IntakeItem {
  readonly foodCode: string;
  readonly quantity: number;
  readonly unit: FoodUnit;
}

/** Consumo registrado por el deportista (HU043). Dato de alimentación: solo en memoria. */
export interface FoodIntake {
  readonly id: string;
  /** Instante ISO 8601 en UTC. */
  readonly consumedAt: string;
  readonly mealType: MealType;
  readonly items: readonly IntakeItem[];
}

/** Una página del historial, en el orden estable del backend (`consumed_at` desc). */
export interface FoodIntakesPage {
  readonly intakes: readonly FoodIntake[];
  /** Cursor opaco de la página siguiente; `null` si no hay más. */
  readonly nextCursor: string | null;
}

/** Consumos de un mismo tipo de comida dentro de un día. */
export interface MealGroup {
  readonly mealType: MealType;
  readonly intakes: readonly FoodIntake[];
}

/** Consumos de un día local, en el orden del backend. */
export interface DayGroup {
  /** Día local `YYYY-MM-DD` en la zona indicada. */
  readonly day: string;
  /** Instante del primer consumo del día, para mostrar la fecha con `DatePipe`. */
  readonly anchor: string;
  readonly meals: readonly MealGroup[];
}

export function toFoodIntakesPage(dto: FoodIntakesPageDto): FoodIntakesPage {
  return {
    intakes: dto.items.map((intake) => ({
      id: intake.intake_id,
      consumedAt: intake.consumed_at,
      mealType: intake.meal_type,
      items: intake.items.map((item) => ({
        foodCode: item.food_code,
        quantity: Number(item.quantity),
        unit: item.unit,
      })),
    })),
    nextCursor: dto.next_cursor,
  };
}

export function hasIntakeFilters(filters: IntakeFilters): boolean {
  return filters.from !== null || filters.to !== null || filters.mealType !== null;
}

/**
 * Validación de experiencia del periodo: `to` no puede ser anterior a `from`
 * (mismo motivo que el `422 to_before_from` del contrato). El backend la repite.
 */
export function periodIsInverted(filters: IntakeFilters): boolean {
  return filters.from !== null && filters.to !== null && filters.to < filters.from;
}

/**
 * Agrupa los consumos por día local y, dentro de cada día, por tipo de comida,
 * sin reordenar: los días y las comidas aparecen en el orden en que llegan del
 * backend (`consumed_at` desc). Una página nueva se agrega al final, así que un
 * día puede continuar con los consumos de la página siguiente.
 */
export function groupByDay(
  intakes: readonly FoodIntake[],
  timeZone: string = browserTimeZone(),
): readonly DayGroup[] {
  const dayOf = dayFormatter(timeZone);
  const days: { day: string; anchor: string; meals: { mealType: MealType; intakes: FoodIntake[] }[] }[] =
    [];
  for (const intake of intakes) {
    const day = dayOf(intake.consumedAt);
    let group = days.find((candidate) => candidate.day === day);
    if (group === undefined) {
      group = { day, anchor: intake.consumedAt, meals: [] };
      days.push(group);
    }
    let meal = group.meals.find((candidate) => candidate.mealType === intake.mealType);
    if (meal === undefined) {
      meal = { mealType: intake.mealType, intakes: [] };
      group.meals.push(meal);
    }
    meal.intakes.push(intake);
  }
  return days;
}

/** Clave i18n del nombre del alimento; `null` si el catálogo no lo tiene (se muestra el código). */
export function foodLabelKey(catalog: FoodCatalog | null, foodCode: string): string | null {
  return catalog?.foods.find((food) => food.code === foodCode)?.labelKey ?? null;
}

function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function dayFormatter(timeZone: string): (instant: string) => string {
  // `en-CA` da `YYYY-MM-DD`, que sirve como clave estable del día.
  const format = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return (instant) => format.format(new Date(instant));
}
