import { EventViolation, KNOWN_EVENT_ISSUES } from './create-event.model';

/** Controles del formulario de HU021. */
export type EventControl =
  | 'name'
  | 'description'
  | 'discipline'
  | 'locationName'
  | 'address'
  | 'city'
  | 'countryCode'
  | 'startDate'
  | 'startTime'
  | 'timeZone'
  | 'durationMinutes'
  | 'capacity';

/** Ruta de `details[].field` (ADR-028) → controles que la representan. */
const CONTROLS_BY_FIELD: Readonly<Record<string, readonly EventControl[]>> = {
  name: ['name'],
  description: ['description'],
  discipline: ['discipline'],
  'location.name': ['locationName'],
  'location.address': ['address'],
  'location.city': ['city'],
  'location.country_code': ['countryCode'],
  starts_at: ['startDate', 'startTime'],
  time_zone: ['timeZone'],
  duration_minutes: ['durationMinutes'],
  capacity: ['capacity'],
};

/** Controles donde se marca la regla; vacío si no corresponde a un campo. */
export function controlsFor(field: string): readonly EventControl[] {
  return CONTROLS_BY_FIELD[field] ?? [];
}

/** Clave i18n del motivo; un motivo desconocido usa un texto genérico. */
export function issueKey(issue: string): string {
  return `events.create.issues.${KNOWN_EVENT_ISSUES.includes(issue) ? issue : 'unknown'}`;
}

/** Clave i18n del campo afectado, para el resumen de reglas incumplidas. */
export function fieldKey(violation: EventViolation): string {
  const [control] = controlsFor(violation.field);
  if (violation.field === 'starts_at') {
    return 'events.create.fields.startsAt';
  }
  if (control) {
    return `events.create.fields.${control}`;
  }
  return violation.field === 'location'
    ? 'events.create.sections.location'
    : 'events.create.issues.fieldRequest';
}
