/**
 * Se ejecuta antes de que exista Angular o i18n: si la configuración no es
 * válida la aplicación no arranca a medias, sino que lo indica explícitamente.
 * El detalle técnico solo va a la consola (la configuración no tiene secretos).
 */
export function renderStartupFailure(document: Document, error: unknown): void {
  console.error('[startup]', error);

  const message = document.createElement('p');
  message.setAttribute('role', 'alert');
  message.dataset['testid'] = 'startup-failure';
  message.textContent =
    'La aplicación no pudo iniciar por un problema de configuración. Contacta al equipo de soporte.';

  document.body.replaceChildren(message);
}
