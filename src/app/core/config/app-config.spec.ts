import { AppConfigError, loadAppConfig, parseAppConfig } from './app-config';

describe('parseAppConfig', () => {
  it('acepta una configuración válida con BFF definido', () => {
    expect(
      parseAppConfig({ environment: 'development', bffWebBaseUrl: 'https://bff.example.test' }),
    ).toEqual({ environment: 'development', bffWebBaseUrl: 'https://bff.example.test' });
  });

  it('acepta bffWebBaseUrl null de forma explícita', () => {
    expect(parseAppConfig({ environment: 'local', bffWebBaseUrl: null })).toEqual({
      environment: 'local',
      bffWebBaseUrl: null,
    });
  });

  it('rechaza contenido que no es un objeto', () => {
    expect(() => parseAppConfig('texto')).toThrowError(AppConfigError);
    expect(() => parseAppConfig(null)).toThrowError(AppConfigError);
    expect(() => parseAppConfig([])).toThrowError(AppConfigError);
  });

  it('reporta todos los problemas encontrados', () => {
    try {
      parseAppConfig({ environment: 'qa' });
      fail('debía lanzar AppConfigError');
    } catch (error) {
      expect(error).toBeInstanceOf(AppConfigError);
      expect((error as AppConfigError).problems.length).toBe(2);
    }
  });

  it('rechaza una URL de BFF que no es http(s)', () => {
    expect(() =>
      parseAppConfig({ environment: 'staging', bffWebBaseUrl: 'javascript:alert(1)' }),
    ).toThrowError(AppConfigError);
    expect(() =>
      parseAppConfig({ environment: 'staging', bffWebBaseUrl: '/relativa' }),
    ).toThrowError(AppConfigError);
  });
});

describe('loadAppConfig', () => {
  it('lee y valida el archivo sin caché', async () => {
    const fetchSpy = jasmine
      .createSpy('fetch')
      .and.resolveTo(new Response(JSON.stringify({ environment: 'local', bffWebBaseUrl: null })));

    const config = await loadAppConfig(fetchSpy, 'app-config.json');

    expect(config.environment).toBe('local');
    expect(fetchSpy).toHaveBeenCalledWith('app-config.json', { cache: 'no-store' });
  });

  it('falla de forma explícita si el archivo no existe', async () => {
    const fetchSpy = jasmine.createSpy('fetch').and.resolveTo(new Response('', { status: 404 }));

    await expectAsync(loadAppConfig(fetchSpy)).toBeRejectedWithError(AppConfigError);
  });
});
