import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { provideTranslateTesting } from '../../../../testing/translate-testing';
import { ApiError } from '../../../core/api/api-error';
import { ViewState } from '../view-state';
import { AsyncState } from './async-state';

@Component({
  imports: [AsyncState],
  template: `
    <app-async-state [state]="state()" (retry)="retries = retries + 1">
      <p data-testid="content">Contenido</p>
    </app-async-state>
  `,
})
class HostComponent {
  readonly state = signal<ViewState<unknown>>({ status: 'loading' });
  retries = 0;
}

describe('AsyncState', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideTranslateTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  async function render(state: ViewState<unknown>): Promise<HTMLElement> {
    fixture.componentInstance.state.set(state);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  function apiError(overrides: Partial<ApiError>): ApiError {
    return { kind: 'server', status: 503, code: null, correlationId: null, ...overrides };
  }

  it('anuncia la carga sin mostrar el contenido', async () => {
    const element = await render({ status: 'loading' });

    const loading = element.querySelector('[data-testid="state-loading"]');
    expect(loading?.getAttribute('role')).toBe('status');
    expect(loading?.textContent).toContain('Cargando…');
    expect(element.querySelector('[data-testid="content"]')).toBeNull();
  });

  it('muestra el contenido proyectado en éxito', async () => {
    const element = await render({ status: 'success', data: [1] });

    expect(element.querySelector('[data-testid="content"]')?.textContent).toContain('Contenido');
  });

  it('muestra el mensaje de vacío', async () => {
    const element = await render({ status: 'empty' });

    expect(element.querySelector('[data-testid="state-empty"]')?.textContent).toContain(
      'No hay información para mostrar.',
    );
    expect(element.querySelector('[data-testid="content"]')).toBeNull();
  });

  it('muestra un error recuperable con referencia y permite reintentar', async () => {
    const element = await render({
      status: 'error',
      error: apiError({ correlationId: 'abc-123' }),
    });

    const alert = element.querySelector('[data-testid="state-error"]');
    expect(alert?.getAttribute('role')).toBe('alert');
    expect(alert?.textContent).toContain('El servicio no está disponible en este momento.');
    expect(alert?.textContent).toContain('Código de referencia: abc-123');

    alert?.querySelector('button')?.click();
    expect(fixture.componentInstance.retries).toBe(1);
  });

  it('no ofrece reintento ante un conflicto de versión', async () => {
    const element = await render({
      status: 'error',
      error: apiError({ kind: 'conflict', status: 409 }),
    });

    const alert = element.querySelector('[data-testid="state-error"]');
    expect(alert?.textContent).toContain('La información cambió mientras trabajabas.');
    expect(alert?.querySelector('button')).toBeNull();
  });

  it('distingue permiso denegado de un error genérico', async () => {
    const element = await render({
      status: 'error',
      error: apiError({ kind: 'forbidden', status: 403 }),
    });

    expect(element.textContent).toContain('No tienes permiso para realizar esta acción.');
  });
});
