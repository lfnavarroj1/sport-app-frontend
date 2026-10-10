import { renderStartupFailure } from './startup-failure';

describe('renderStartupFailure', () => {
  it('reemplaza la aplicación por un mensaje accesible sin detalles internos', () => {
    const doc = document.implementation.createHTMLDocument('prueba');
    doc.body.innerHTML = '<app-root></app-root>';
    spyOn(console, 'error');

    renderStartupFailure(doc, new Error('detalle interno'));

    const alert = doc.querySelector('[data-testid="startup-failure"]');
    expect(alert?.getAttribute('role')).toBe('alert');
    expect(doc.body.textContent).not.toContain('detalle interno');
    expect(doc.querySelector('app-root')).toBeNull();
  });
});
