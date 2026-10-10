import { TestBed } from '@angular/core/testing';

import { APP_CONFIG, AppConfig } from '../config/app-config';
import { BffNotConfiguredError, BffWebUrl } from './bff-web-url';

describe('BffWebUrl', () => {
  function setup(config: AppConfig): BffWebUrl {
    TestBed.configureTestingModule({ providers: [{ provide: APP_CONFIG, useValue: config }] });
    return TestBed.inject(BffWebUrl);
  }

  it('une la URL base y la ruta sin duplicar barras', () => {
    const bff = setup({ environment: 'development', bffWebBaseUrl: 'https://bff.example.test/' });

    expect(bff.isConfigured).toBeTrue();
    expect(bff.resolve('/v1/recurso')).toBe('https://bff.example.test/v1/recurso');
  });

  it('falla de forma explícita cuando el BFF no está configurado', () => {
    const bff = setup({ environment: 'local', bffWebBaseUrl: null });

    expect(bff.isConfigured).toBeFalse();
    expect(() => bff.resolve('v1/recurso')).toThrowError(BffNotConfiguredError);
  });
});
