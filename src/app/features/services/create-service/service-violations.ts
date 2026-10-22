import { KNOWN_SERVICE_ISSUES, ServiceViolation } from './create-service.model';

/** Controles del servicio en el formulario de HU015. */
export type ServiceControl =
  'name' | 'description' | 'category' | 'modality' | 'amount' | 'currency' | 'billingUnit';

/** Controles de cada intervalo de disponibilidad. */
export type IntervalControl =
  'startDate' | 'startTime' | 'endDate' | 'endTime' | 'timeZone' | 'capacity';

/** Dónde se marca una regla del backend. */
export type ViolationTarget =
  | { readonly kind: 'service'; readonly controls: readonly ServiceControl[] }
  | {
      readonly kind: 'interval';
      readonly index: number;
      readonly controls: readonly IntervalControl[];
    }
  | { readonly kind: 'none' };

/** Ruta de `details[].field` (ADR-027) → controles del servicio. */
const SERVICE_CONTROLS: Readonly<Record<string, readonly ServiceControl[]>> = {
  name: ['name'],
  description: ['description'],
  category: ['category'],
  modality: ['modality'],
  price: ['amount'],
  'price.amount': ['amount'],
  'price.currency': ['currency'],
  'price.billing_unit': ['billingUnit'],
};

/** Propiedad de un intervalo → controles que la representan. */
const INTERVAL_CONTROLS: Readonly<Record<string, readonly IntervalControl[]>> = {
  '': ['startDate', 'startTime', 'endDate', 'endTime'],
  starts_at: ['startDate', 'startTime'],
  ends_at: ['endDate', 'endTime'],
  time_zone: ['timeZone'],
  capacity: ['capacity'],
};

/** `availability[3].starts_at` → índice 3 y propiedad `starts_at`; `availability[3]` → propiedad vacía. */
const INTERVAL_FIELD = /^availability\[(\d+)\](?:\.(\w+))?$/;

/** Controles donde se marca la regla; `none` si no corresponde a un campo editable. */
export function targetFor(field: string): ViolationTarget {
  const service = SERVICE_CONTROLS[field];
  if (service) {
    return { kind: 'service', controls: service };
  }
  const match = INTERVAL_FIELD.exec(field);
  const controls = match ? INTERVAL_CONTROLS[match[2] ?? ''] : undefined;
  if (match && controls) {
    return { kind: 'interval', index: Number(match[1]), controls };
  }
  return { kind: 'none' };
}

/** Clave i18n del motivo; un motivo desconocido usa un texto genérico. */
export function issueKey(issue: string): string {
  return `services.create.issues.${KNOWN_SERVICE_ISSUES.includes(issue) ? issue : 'unknown'}`;
}

/**
 * Texto del campo afectado, para el resumen de reglas incumplidas. En un
 * intervalo, `key` recibe su número y el texto de `fieldKey` («Horario 2 · Inicio»).
 */
export interface FieldLabel {
  readonly key: string;
  readonly number: number | null;
  readonly fieldKey: string | null;
}

const INTERVAL_FIELD_KEYS: Readonly<Record<string, string>> = {
  '': 'services.create.intervals.title',
  starts_at: 'services.create.summary.startsAt',
  ends_at: 'services.create.summary.endsAt',
  time_zone: 'services.create.fields.timeZone',
  capacity: 'services.create.fields.capacity',
};

/** Campo afectado: del servicio, de un intervalo («Horario 2 · Inicio») o de la solicitud. */
export function fieldLabel(violation: ServiceViolation): FieldLabel {
  const target = targetFor(violation.field);
  if (target.kind === 'service') {
    const [control] = target.controls;
    return { key: `services.create.fields.${control}`, number: null, fieldKey: null };
  }
  if (target.kind === 'interval') {
    const property = INTERVAL_FIELD.exec(violation.field)?.[2] ?? '';
    return {
      key: 'services.create.intervals.fieldOf',
      number: target.index + 1,
      fieldKey: INTERVAL_FIELD_KEYS[property],
    };
  }
  const key =
    violation.field === 'availability'
      ? 'services.create.sections.availability'
      : 'services.create.issues.fieldRequest';
  return { key, number: null, fieldKey: null };
}
