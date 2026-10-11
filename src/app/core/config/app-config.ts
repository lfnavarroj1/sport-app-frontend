import { InjectionToken } from '@angular/core';

export const APP_ENVIRONMENTS = ['local', 'development', 'staging', 'production'] as const;

export type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];

/**
 * Configuración de ejecución. Se lee de `app-config.json` al arrancar para que el
 * mismo artefacto pueda promoverse entre ambientes sin recompilar.
 * Nunca debe contener secretos.
 */
export interface AppConfig {
  readonly environment: AppEnvironment;
  /**
   * URL base del BFF web. `null` indica que todavía no está definida para el
   * ambiente: cualquier intento de usarla falla de forma explícita.
   */
  readonly bffWebBaseUrl: string | null;
  /**
   * Versión vigente de las políticas que acepta quien se registra (HU001). Debe
   * coincidir con `REGISTRATION_POLICIES_VERSION` de users-management en el mismo
   * ambiente. `null` deja el registro no disponible.
   */
  readonly registrationPoliciesVersion: string | null;
}

/** Límite de `accepted_policies_version` en el contrato bff-web 0.2.0. */
const POLICIES_VERSION_MAX_LENGTH = 32;

export const APP_CONFIG = new InjectionToken<AppConfig>('APP_CONFIG');

export class AppConfigError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Configuración de la aplicación inválida: ${problems.join('; ')}`);
    this.name = 'AppConfigError';
  }
}

/** Una operación necesita un valor de configuración que este ambiente no define. */
export class ConfigValueMissingError extends Error {
  constructor(readonly key: keyof AppConfig) {
    super(`El valor de configuración "${key}" no está definido para este ambiente.`);
    this.name = 'ConfigValueMissingError';
  }
}

export function parseAppConfig(raw: unknown): AppConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new AppConfigError(['el contenido debe ser un objeto JSON']);
  }

  const candidate = raw as Record<string, unknown>;
  const problems: string[] = [];

  const environment = candidate['environment'];
  if (!APP_ENVIRONMENTS.includes(environment as AppEnvironment)) {
    problems.push(`"environment" debe ser uno de: ${APP_ENVIRONMENTS.join(', ')}`);
  }

  if (!('bffWebBaseUrl' in candidate)) {
    problems.push('"bffWebBaseUrl" es obligatorio (use null si aún no está definido)');
  }
  const bffWebBaseUrl = candidate['bffWebBaseUrl'];
  if (bffWebBaseUrl !== null && bffWebBaseUrl !== undefined && !isHttpUrl(bffWebBaseUrl)) {
    problems.push('"bffWebBaseUrl" debe ser una URL http(s) absoluta o null');
  }

  if (!('registrationPoliciesVersion' in candidate)) {
    problems.push(
      '"registrationPoliciesVersion" es obligatorio (use null si aún no está definido)',
    );
  }
  const policiesVersion = candidate['registrationPoliciesVersion'];
  if (
    policiesVersion !== null &&
    policiesVersion !== undefined &&
    !isPoliciesVersion(policiesVersion)
  ) {
    problems.push(
      `"registrationPoliciesVersion" debe ser un texto de 1 a ${POLICIES_VERSION_MAX_LENGTH} caracteres o null`,
    );
  }

  if (problems.length > 0) {
    throw new AppConfigError(problems);
  }

  return {
    environment: environment as AppEnvironment,
    bffWebBaseUrl: (bffWebBaseUrl as string | null) ?? null,
    registrationPoliciesVersion: (policiesVersion as string | null) ?? null,
  };
}

export async function loadAppConfig(
  fetchFn: typeof fetch = fetch,
  url = 'app-config.json',
): Promise<AppConfig> {
  const response = await fetchFn(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new AppConfigError([`no se pudo leer ${url} (HTTP ${response.status})`]);
  }
  return parseAppConfig(await response.json());
}

function isPoliciesVersion(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= POLICIES_VERSION_MAX_LENGTH
  );
}

function isHttpUrl(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
