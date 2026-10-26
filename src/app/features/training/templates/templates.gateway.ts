import { PublishOutcome, RetireOutcome, TemplateDraft, TemplatesPage } from './templates.model';

/**
 * Puerto hacia el BFF web para las plantillas de plan del profesional (HU028,
 * ADR-041). `HttpTemplatesGateway` traduce el contrato bff-web 0.24.0.
 */
export abstract class TemplatesGateway {
  /**
   * Página de plantillas propias (publicadas y retiradas). `cursor` es el
   * `nextCursor` anterior, sin modificar. Rechaza con el error original: nunca se
   * interpreta como lista vacía.
   */
  abstract loadTemplates(cursor: string | null): Promise<TemplatesPage>;

  /**
   * Publica una plantilla.
   *
   * @param idempotencyKey igual en todos los intentos del mismo intento lógico.
   * @param onRetry se invoca antes de cada reintento automático (1, 2 o 3).
   * Resuelve siempre con un `PublishOutcome`; los fallos nunca se expresan como éxito.
   */
  abstract publish(
    draft: TemplateDraft,
    idempotencyKey: string,
    onRetry?: (attempt: number) => void,
  ): Promise<PublishOutcome>;

  /** Retira una plantilla propia con la versión que muestra la pantalla. */
  abstract retire(templateId: string, expectedVersion: number): Promise<RetireOutcome>;
}
