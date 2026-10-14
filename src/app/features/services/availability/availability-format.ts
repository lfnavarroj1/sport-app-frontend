/**
 * Formatos de presentación de HU020. Solo cambian cómo se muestra el dato: el
 * instante y el importe siguen siendo los que entregó el backend.
 */

/** Zona horaria IANA del navegador (p. ej. `America/Bogota`). */
export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Tarifa informativa en pesos colombianos (CA6), de 0 a 2 decimales. `amount` es
 * la cadena decimal del contrato (`"10000.00"`).
 */
export function formatPrice(amount: string, locale = 'es-CO'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(amount));
}

/**
 * Intervalo `[startsAt, endsAt)` en la zona del navegador sin alterar el instante
 * (CA3): fecha y hora del inicio; del fin, solo la hora si cae el mismo día local
 * y, si no, fecha y hora. `timeZone` existe para fijar la zona en las pruebas.
 */
export function formatIntervalRange(
  startsAt: string,
  endsAt: string,
  locale: string,
  timeZone: string = browserTimeZone(),
): { start: string; end: string } {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const dateTime = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  });
  const day = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone,
  });
  const sameDay = day.format(start) === day.format(end);
  return {
    start: dateTime.format(start),
    end: sameDay
      ? new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone }).format(end)
      : dateTime.format(end),
  };
}
