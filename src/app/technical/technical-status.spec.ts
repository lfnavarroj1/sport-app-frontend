import { TestBed } from '@angular/core/testing';

import { provideTranslateTesting } from '../../testing/translate-testing';
import { APP_CONFIG, AppConfig } from '../core/config/app-config';
import { TechnicalStatus } from './technical-status';

describe('TechnicalStatus', () => {
  async function render(config: AppConfig): Promise<HTMLElement> {
    TestBed.configureTestingModule({
      imports: [TechnicalStatus],
      providers: [provideTranslateTesting(), { provide: APP_CONFIG, useValue: config }],
    });
    const fixture = TestBed.createComponent(TechnicalStatus);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  function field(element: HTMLElement, testId: string): string {
    return element.querySelector(`[data-testid="${testId}"]`)?.textContent?.trim() ?? '';
  }

  it('muestra ambiente, idioma e identificador de diagnóstico', async () => {
    const element = await render({ environment: 'local', bffWebBaseUrl: null });

    expect(element.querySelector('h1')?.textContent).toContain('Estado técnico');
    expect(field(element, 'environment')).toBe('local');
    expect(field(element, 'language')).toBe('es');
    expect(field(element, 'diagnostic-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('indica si el BFF web está configurado sin mostrar la URL', async () => {
    const configured = await render({
      environment: 'development',
      bffWebBaseUrl: 'https://bff.example.test',
    });

    expect(field(configured, 'bff-status')).toBe('Configurado');
    expect(configured.textContent).not.toContain('bff.example.test');
  });

  it('indica cuando el BFF web no está configurado', async () => {
    const element = await render({ environment: 'local', bffWebBaseUrl: null });

    expect(field(element, 'bff-status')).toBe('No configurado');
  });
});
