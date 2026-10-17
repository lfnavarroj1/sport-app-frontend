/**
 * Aviso de tratamiento de datos personales de SportApp (HU001). Su texto vive en
 * `public/i18n/es.json` (`privacyNotice.*`) y corresponde a una sola versión: la
 * que el responsable aprobó como versión compartida de las políticas de registro
 * (2026-10-17). La web solo ofrece aceptar esa versión: si la configuración del
 * ambiente indica otra, el registro no se habilita (se aceptaría un texto que no
 * se muestra).
 */
export const PRIVACY_NOTICE_VERSION = 'sportapp-c108-c108plus.v1';

/** Ruta pública del aviso; se abre también desde el formulario de registro. */
export const PRIVACY_NOTICE_PATH = '/aviso-de-privacidad';

/**
 * Referencias oficiales del Consejo de Europa que orientan el aviso. Son
 * referencias, no una certificación de cumplimiento.
 */
export const PRIVACY_NOTICE_REFERENCES = [
  {
    id: 'convention108',
    url: 'https://www.coe.int/en/web/data-protection/convention108-and-protocol',
  },
  {
    id: 'convention108plus',
    url: 'https://www.coe.int/en/web/data-protection/convention108/modernised',
  },
] as const;

/**
 * Secciones del aviso y la cantidad de párrafos o elementos de cada una, en el
 * orden en que se presentan. Las claves `privacyNotice.sections.<id>.*` y sus
 * elementos `items.<n>` están en `es.json`. Un dato que el proyecto aún no definió
 * se informa como pendiente en el propio texto, sin inventarlo.
 */
export interface PrivacyNoticeSection {
  readonly id: string;
  /** Párrafos `paragraphs.<n>` de la sección. */
  readonly paragraphs: number;
  /** Elementos de lista `items.<n>` de la sección. */
  readonly items: number;
}

export const PRIVACY_NOTICE_SECTIONS: readonly PrivacyNoticeSection[] = [
  { id: 'controller', paragraphs: 1, items: 0 },
  { id: 'data', paragraphs: 1, items: 4 },
  { id: 'purposes', paragraphs: 1, items: 6 },
  { id: 'minimization', paragraphs: 0, items: 3 },
  { id: 'retention', paragraphs: 1, items: 0 },
  { id: 'security', paragraphs: 0, items: 4 },
  { id: 'recipients', paragraphs: 0, items: 4 },
  { id: 'sensitive', paragraphs: 0, items: 4 },
  { id: 'rights', paragraphs: 1, items: 4 },
  { id: 'exercise', paragraphs: 1, items: 0 },
];

/** Índices `0..count-1` para recorrer párrafos o elementos en la plantilla. */
export function indexes(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index);
}
