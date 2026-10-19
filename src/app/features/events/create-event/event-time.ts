/**
 * Fechas y zonas horarias del evento (HU021, ADR-028). El contrato pide
 * `starts_at` con desfase explícito coherente con la zona IANA declarada y
 * responde los instantes en UTC; la web convierte en ambos sentidos con `Intl`,
 * sin decidir si la fecha es válida para el negocio (lo valida el backend).
 */

/** Desfase en minutos de `timeZone` respecto a UTC en el instante `epochMs`. */
export function offsetMinutes(timeZone: string, epochMs: number): number {
  const instant = Math.floor(epochMs / 1000) * 1000;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((item) => item.type === type)?.value);
  const wall = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );
  return Math.round((wall - instant) / 60_000);
}

/** `-05:00`, `+00:00`, `+05:30`… */
export function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const absolute = Math.abs(minutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, '0');
  return `${sign}${hours}:${String(absolute % 60).padStart(2, '0')}`;
}

/** La zona es una zona IANA que el navegador conoce. */
export function isKnownTimeZone(timeZone: string): boolean {
  if (timeZone.trim() === '') {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Instante ISO 8601 con desfase para la hora local `date` (`YYYY-MM-DD`) y `time`
 * (`HH:mm`) en `timeZone`: `2026-11-15T07:00:00-05:00`. El desfase es el de la
 * zona en ese instante (incluye horario de verano). Una hora inexistente por un
 * cambio de horario queda con un desfase que el backend rechaza como
 * `time_zone_offset_mismatch`.
 */
export function zonedStartsAt(date: string, time: string, timeZone: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const firstGuess = offsetMinutes(timeZone, wall);
  const offset = offsetMinutes(timeZone, wall - firstGuess * 60_000);
  return `${date}T${time.slice(0, 5)}:00${formatOffset(offset)}`;
}

/** Zonas IANA que ofrece el navegador, para sugerirlas al escribir. */
export function timeZoneOptions(): readonly string[] {
  return Intl.supportedValuesOf('timeZone');
}

/** Zona del navegador: valor inicial del formulario. */
export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Fecha y hora del instante `iso` en la zona del evento, en el idioma indicado. */
export function formatInZone(iso: string, timeZone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(new Date(iso));
}

/** Nombre del país para un código ISO 3166-1 alfa-2, o `null` si no se conoce. */
export function countryName(code: string, locale: string): string | null {
  if (!/^[A-Z]{2}$/.test(code)) {
    return null;
  }
  try {
    const name = new Intl.DisplayNames([locale], { type: 'region' }).of(code);
    return name && name !== code ? name : null;
  } catch {
    return null;
  }
}
