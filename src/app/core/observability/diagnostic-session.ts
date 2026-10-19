import { Injectable } from '@angular/core';

/**
 * Identificador técnico de la sesión del navegador, útil para correlacionar
 * reportes de soporte. No contiene datos personales.
 *
 * Su propagación al BFF queda pendiente: el nombre de la cabecera de
 * correlación debe venir del contrato del BFF web.
 */
@Injectable({ providedIn: 'root' })
export class DiagnosticSession {
  readonly id: string = crypto.randomUUID();
}
