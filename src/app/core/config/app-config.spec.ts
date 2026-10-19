import { AppConfigError, loadAppConfig, parseAppConfig } from './app-config';

describe('parseAppConfig', () => {
  it('acepta una configuración válida con BFF y versiones de políticas y consentimiento', () => {
    expect(
      parseAppConfig({
        environment: 'development',
        bffWebBaseUrl: 'https://bff.example.test',
        registrationPoliciesVersion: 'politicas-2026-10',
        healthDataConsentVersion: 'health-2026-10-12.v1',
      }),
    ).toEqual({
      environment: 'development',
      bffWebBaseUrl: 'https://bff.example.test',
      registrationPoliciesVersion: 'politicas-2026-10',
      healthDataConsentVersion: 'health-2026-10-12.v1',
    });
  });

  it('acepta bffWebBaseUrl y las versiones en null de forma explícita', () => {
    expect(
      parseAppConfig({
        environment: 'local',
        bffWebBaseUrl: null,
        registrationPoliciesVersion: null,
        healthDataConsentVersion: null,
      }),
    ).toEqual({
      environment: 'local',
      bffWebBaseUrl: null,
      registrationPoliciesVersion: null,
      healthDataConsentVersion: null,
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
      expect((error as AppConfigError).problems.length).toBe(4);
    }
  });

  it('exige healthDataConsentVersion aunque sea null (HU005)', () => {
    try {
      parseAppConfig({
        environment: 'local',
        bffWebBaseUrl: null,
        registrationPoliciesVersion: null,
      });
      fail('debía lanzar AppConfigError');
    } catch (error) {
      expect((error as AppConfigError).problems).toEqual([
        '"healthDataConsentVersion" es obligatorio (use null si aún no está definido)',
      ]);
    }
  });

  it('rechaza una URL de BFF que no es http(s)', () => {
    for (const bffWebBaseUrl of ['javascript:alert(1)', '/relativa']) {
      expect(() =>
        parseAppConfig({
          environment: 'staging',
          bffWebBaseUrl,
          registrationPoliciesVersion: null,
          healthDataConsentVersion: null,
        }),
      ).toThrowError(AppConfigError);
    }
  });

  it('rechaza una versión de políticas vacía, demasiado larga o que no es texto', () => {
    for (const registrationPoliciesVersion of ['', '   ', 'x'.repeat(33), 7]) {
      expect(() =>
        parseAppConfig({
          environment: 'local',
          bffWebBaseUrl: null,
          registrationPoliciesVersion,
          healthDataConsentVersion: null,
        }),
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
        healthDataConsentVersion: null,
      }).registrationPoliciesVersion,
    ).toBe(version);
  });

  it('rechaza una versión de consentimiento vacía, demasiado larga o que no es texto', () => {
    for (const healthDataConsentVersion of ['', '   ', 'x'.repeat(65), 7]) {
      expect(() =>
        parseAppConfig({
          environment: 'local',
          bffWebBaseUrl: null,
          registrationPoliciesVersion: null,
          healthDataConsentVersion,
        }),
      ).toThrowError(AppConfigError);
    }
  });

  it('acepta una versión de consentimiento de 64 caracteres (límite de users-management)', () => {
    const version = 'h'.repeat(64);

    expect(
      parseAppConfig({
        environment: 'local',
        bffWebBaseUrl: null,
        registrationPoliciesVersion: null,
        healthDataConsentVersion: version,
      }).healthDataConsentVersion,
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
          healthDataConsentVersion: null,
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
