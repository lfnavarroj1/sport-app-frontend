import {
  CREATE_SESSION_PATH,
  CREATE_SESSION_RESPONSES,
  VALID_LOGIN_REQUEST,
} from '../../../../testing/bff-web/create-session.fixtures';
import {
  REFRESH_SESSION_PATH,
  REFRESH_SESSION_RESPONSES,
} from '../../../../testing/bff-web/refresh-session.fixtures';
import {
  OpenApiDocument,
  OpenApiOperation,
  responseSchema,
  validateAgainstSchema,
} from '../../../../testing/openapi-schema';
import contractJson from '../contracts/bff-web.openapi.json';
import { ACTOR_TYPES, BFF_WEB_CONTRACT_VERSION } from './contract';
import {
  CREATE_SESSION_ERROR_CODES,
  LoginRequestDto,
  REFRESH_SESSION_ERROR_CODES,
  WebSessionResponseDto,
} from './sessions.api';

const contract = contractJson as unknown as OpenApiDocument;
const createOperation: OpenApiOperation = contract.paths[CREATE_SESSION_PATH]['post'];
const refreshOperation: OpenApiOperation = contract.paths[REFRESH_SESSION_PATH]['post'];
const requestSchema = createOperation.requestBody!.content['application/json'].schema;
const schemas = contract.components.schemas as Record<
  string,
  { properties: Record<string, { enum?: string[] }>; required?: string[] }
>;
const REFRESH_COOKIE = '__Secure-sportapp_refresh';

function declaredCodes(operation: OpenApiOperation, status: number): string[] {
  const description = operation.responses[String(status)]?.description ?? '';
  return [...description.matchAll(/`([a-z_]+)`/g)].map((match) => match[1]);
}

function setCookieDescription(operation: OpenApiOperation): string {
  const header = operation.responses['200'].headers?.['Set-Cookie'] as
    { description?: string } | undefined;
  return header?.description ?? '';
}

describe('Contrato bff-web: sesiones (HU003)', () => {
  it('la copia del contrato es la versión que declara el cliente', () => {
    expect(contract.info.version).toBe(BFF_WEB_CONTRACT_VERSION);
  });

  it('el modelo de respuesta tiene exactamente las propiedades obligatorias de WebSessionResponse', () => {
    const response: WebSessionResponseDto = CREATE_SESSION_RESPONSES.authenticated.body;

    expect(Object.keys(response).sort()).toEqual(schemas['WebSessionResponse'].required!.sort());
    expect(Object.keys(schemas['WebSessionResponse'].properties)).not.toContain('refresh_token');
    expect<string[]>([...ACTOR_TYPES]).toEqual(
      schemas['SessionUser'].properties['actor_type'].enum!,
    );
  });

  describe('POST /v1/sessions', () => {
    it('corresponde a la operación de creación de sesión, sin parámetros adicionales', () => {
      expect(createOperation.operationId).toBe('create_session_v1_sessions_post');
      expect(createOperation.parameters ?? []).toEqual([]);
    });

    it('la solicitud del cliente tiene exactamente las propiedades del contrato', () => {
      const request: LoginRequestDto = VALID_LOGIN_REQUEST;

      expect(Object.keys(request).sort()).toEqual(
        Object.keys(schemas['LoginRequest'].properties).sort(),
      );
      expect(validateAgainstSchema(contract, requestSchema, request)).toEqual([]);
    });

    it('fija el refresh token en la cookie HttpOnly, no en el cuerpo', () => {
      expect(setCookieDescription(createOperation)).toContain(REFRESH_COOKIE);
      expect(setCookieDescription(createOperation)).toContain('HttpOnly');
    });

    it('declara Retry-After en la respuesta 429', () => {
      expect(createOperation.responses['429'].headers?.['Retry-After']?.schema['type']).toBe(
        'integer',
      );
    });

    it('los códigos de error del cliente son los que declara el contrato', () => {
      const declared = [401, 403, 422, 429, 503, 504]
        .flatMap((status) => declaredCodes(createOperation, status))
        .sort();

      expect<string[]>(Object.values(CREATE_SESSION_ERROR_CODES).sort()).toEqual(declared);
    });

    for (const [name, response] of Object.entries(CREATE_SESSION_RESPONSES)) {
      it(`la respuesta simulada "${name}" (${response.status}) cumple el contrato`, () => {
        const schema = responseSchema(createOperation, response.status);

        expect(validateAgainstSchema(contract, schema, response.body)).toEqual([]);
        if (response.status >= 400) {
          expect(declaredCodes(createOperation, response.status)).toContain(
            (response.body as { code: string }).code,
          );
        }
      });
    }
  });

  describe('POST /v1/sessions/refresh', () => {
    it('corresponde a la operación de renovación: sin cuerpo y con la cookie como única credencial', () => {
      expect(refreshOperation.operationId).toBe('refresh_v1_sessions_refresh_post');
      expect(refreshOperation.requestBody).toBeUndefined();
      expect(
        (refreshOperation.parameters ?? []).map((parameter) => [parameter.in, parameter.name]),
      ).toEqual([['cookie', REFRESH_COOKIE]]);
    });

    it('rota la cookie HttpOnly en cada renovación', () => {
      expect(setCookieDescription(refreshOperation)).toContain(REFRESH_COOKIE);
      expect(setCookieDescription(refreshOperation)).toContain('HttpOnly');
    });

    it('los códigos de error del cliente son los que declara el contrato', () => {
      const declared = [401, 403, 503, 504]
        .flatMap((status) => declaredCodes(refreshOperation, status))
        .sort();

      expect<string[]>(Object.values(REFRESH_SESSION_ERROR_CODES).sort()).toEqual(declared);
    });

    for (const [name, response] of Object.entries(REFRESH_SESSION_RESPONSES)) {
      it(`la respuesta simulada "${name}" (${response.status}) cumple el contrato`, () => {
        const schema = responseSchema(refreshOperation, response.status);

        expect(validateAgainstSchema(contract, schema, response.body)).toEqual([]);
        if (response.status >= 400) {
          expect(declaredCodes(refreshOperation, response.status)).toContain(
            (response.body as { code: string }).code,
          );
        }
      });
    }
  });
});
