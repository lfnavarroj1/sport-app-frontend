import { CalendarPeriod } from '../event-calendar/event-calendar.model';
import { IntegratedCalendar } from './integrated-calendar.model';

/**
 * Puerto hacia el BFF web para el calendario integrado de los tres actores
 * (HU018, ADR-039). La pantalla depende solo de esta abstracción;
 * `HttpIntegratedCalendarGateway` traduce el contrato bff-web 0.30.0. La consulta
 * rechaza con el error original: un fallo nunca se interpreta como calendario
 * vacío.
 */
export abstract class IntegratedCalendarGateway {
  /** Calendario del actor de la sesión en `[from, to)`, compuesto por el BFF. */
  abstract load(period: CalendarPeriod): Promise<IntegratedCalendar>;
}
