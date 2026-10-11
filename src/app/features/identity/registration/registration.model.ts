import { ApiError } from '../../../core/api/api-error';

/** Campos del formulario de registro (HU001). */
export type RegistrationField = 'fullName' | 'email' | 'password' | 'actorType' | 'policies';

export interface ActorTypeOption {
  /** Código del catálogo permitido; lo define el contrato del BFF. */
  readonly code: string;
}

export interface RegistrationOptions {
  readonly actorTypes: readonly ActorTypeOption[];
  /** Versión vigente de las políticas que el usuario acepta al registrarse. */
  readonly policiesVersion: string;
}

/** Errores de campo informados por el backend tras un envío. */
export interface RegistrationServerErrors {
  readonly emailTaken: boolean;
  /** La versión de políticas aceptada ya no es la vigente en el backend. */
  readonly policiesOutdated: boolean;
  readonly invalidFields: readonly RegistrationField[];
}

/** Datos capturados por el formulario. La contraseña solo vive durante el envío. */
export interface RegistrationDraft {
  readonly fullName: string;
  readonly email: string;
  readonly password: string;
  readonly actorType: string;
  readonly acceptedPoliciesVersion: string;
}

/** Resultado del comando, ya traducido desde el contrato por el adaptador. */
export type RegistrationOutcome =
  | { readonly kind: 'registered'; readonly userId: string; readonly email: string }
  | { readonly kind: 'email_taken' }
  | { readonly kind: 'invalid'; readonly fields: readonly RegistrationField[] }
  | { readonly kind: 'policies_outdated' }
  | { readonly kind: 'failed'; readonly error: ApiError };
