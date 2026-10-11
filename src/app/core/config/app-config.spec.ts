import { AppConfigError, loadAppConfig, parseAppConfig } from './app-config';

describe('parseAppConfig', () => {
  it('acepta una configuración válida con BFF y versión de políticas definidos', () => {
    expect(
      parseAppConfig({
        environment: 'development',
        bffWebBaseUrl: 'https://bff.example.test',
        registrationPoliciesVersion: 'politicas-2026-10',
      }),
    ).toEqual({
      environment: 'development',
      bffWebBaseUrl: 'https://bff.example.test',
      registrationPoliciesVersion: 'politicas-2026-10',
    });
  });

  it('acepta bffWebBaseUrl y registrationPoliciesVersion null de forma explícita', () => {
    expect(
      parseAppConfig({
        environment: 'local',
        bffWebBaseUrl: null,
        registrationPoliciesVersion: null,
      }),
    ).toEqual({ environment: 'local', bffWebBaseUrl: null, registrationPoliciesVersion: null });
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
      expect((error as AppConfigError).problems.length).toBe(3);
    }
  });

  it('rechaza una URL de BFF que no es http(s)', () => {
    for (const bffWebBaseUrl of ['javascript:alert(1)', '/relativa']) {
      expect(() =>
        parseAppConfig({
          environment: 'staging',
          bffWebBaseUrl,
          registrationPoliciesVersion: null,
        }),
      ).toThrowError(AppConfigError);
    }
  });

  it('rechaza una versión de políticas vacía, demasiado larga o que no es texto', () => {
    for (const registrationPoliciesVersion of ['', '   ', 'x'.repeat(33), 7]) {
      expect(() =>
        parseAppConfig({ environment: 'local', bffWebBaseUrl: null, registrationPoliciesVersion }),
      ).toThrowError(AppConfigError);
    }
  });

  it('acepta una versión de políticas de 32 caracteres (límite del contrato)', () => {
    const version = 'v'.repeat(32);

    expect(
      parseAppConfig({
        environment: 'local',
        bffWebBaseUrl: null,
        registrationPoliciesVersion: version,
      }).registrationPoliciesVersion,
    ).toBe(version);
  });
});

describe('loadAppConfig', () => {
  it('lee y valida el archivo sin caché', async () => {
    const fetchSpy = jasmine.createSpy('fetch').and.resolveTo(
      new Response(
        JSON.stringify({
          environment: 'local',
          bffWebBaseUrl: null,
          registrationPoliciesVersion: null,
        }),
      ),
    );

    const config = await loadAppConfig(fetchSpy, 'app-config.json');

    expect(config.environment).toBe('local');
    expect(fetchSpy).toHaveBeenCalledWith('app-config.json', { cache: 'no-store' });
  });

  it('falla de forma explícita si el archivo no existe', async () => {
    const fetchSpy = jasmine.createSpy('fetch').and.resolveTo(new Response('', { status: 404 }));

    await expectAsync(loadAppConfig(fetchSpy)).toBeRejectedWithError(AppConfigError);
  });
});
