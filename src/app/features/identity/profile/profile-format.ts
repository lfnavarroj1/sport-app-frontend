/**
 * Formatos de presentación del perfil (HU005). Solo cambian cómo se muestra el
 * dato: los valores siguen siendo los que confirmó el backend. Los decimales no
 * pasan por `Number`, para no alterar el texto del contrato (`"68.5"`).
 */

/** Zona horaria IANA del navegador (p. ej. `America/Bogota`). */
export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Fecha de nacimiento (`YYYY-MM-DD`) en fecha larga, sin desfase: se formatea en
 * UTC para que la zona del navegador no la mueva al día anterior.
 */
export function formatBirthDate(date: string, locale: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    return date;
  }
  const [, year, month, day] = match.map(Number);
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, month - 1, day)),
  );
}

/**
 * Instante UTC (`measured_at`, `updated_at`, `accepted_at`) en fecha larga y hora
 * corta de la zona del navegador. `timeZone` existe para fijar la zona en las pruebas.
 */
export function formatInstant(
  iso: string,
  locale: string,
  timeZone: string = browserTimeZone(),
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone,
  }).format(date);
}

/** Decimal del contrato con el separador decimal del idioma (`"68.5"` → `68,5` en `es`). */
export function formatDecimal(text: string, locale: string): string {
  return text.replace('.', decimalSeparator(locale));
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

/** País con su nombre y su código (`Colombia (CO)`); solo el código si no se conoce. */
export function formatCountry(code: string, locale: string): string {
  const name = countryName(code, locale);
  return name === null ? code : `${name} (${code})`;
}

function decimalSeparator(locale: string): string {
  return (
    new Intl.NumberFormat(locale).formatToParts(1.5).find((part) => part.type === 'decimal')
      ?.value ?? '.'
  );
}
