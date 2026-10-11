import {
  CREATE_SESSION_PATH,
  CREATE_SESSION_RESPONSES,
  VALID_LOGIN_REQUEST,
} from '../../../../testing/bff-web/create-session.fixtures';
import {
  OpenApiDocument,
  OpenApiOperation,
  responseSchema,
  validateAgainstSchema,
} from '../../../../testing/openapi-schema';
import contractJson from '../contracts/bff-web.openapi.json';
import { ACTOR_TYPES } from './contract';
import { CREATE_SESSION_ERROR_CODES, LoginRequestDto, SessionResponseDto } from './sessions.api';

const contract = contractJson as unknown as OpenApiDocument;
const operation: OpenApiOperation = contract.paths[CREATE_SESSION_PATH]['post'];
const requestSchema = operation.requestBody!.content['application/json'].schema;
const schemas = contract.components.schemas as Record<
  string,
  { properties: Record<string, { enum?: string[] }>; required?: string[] }
>;

function declaredCodes(status: number): string[] {
  const description = operation.responses[String(status)]?.description ?? '';
  return [...description.matchAll(/`([a-z_]+)`/g)].map((match) => match[1]);
}

describe('Contrato bff-web: POST /v1/sessions (HU003)', () => {
  it('corresponde a la operación de creación de sesión, sin parámetros adicionales', () => {
    expect(operation.operationId).toBe('create_session_v1_sessions_post');
    expect(operation.parameters ?? []).toEqual([]);
  });

  it('la solicitud del cliente tiene exactamente las propiedades del contrato', () => {
    const request: LoginRequestDto = VALID_LOGIN_REQUEST;

    expect(Object.keys(request).sort()).toEqual(
      Object.keys(schemas['LoginRequest'].properties).sort(),
    );
    expect(validateAgainstSchema(contract, requestSchema, request)).toEqual([]);
  });

  it('el modelo de respuesta cubre las propiedades obligatorias de SessionResponse', () => {
    const response: SessionResponseDto = CREATE_SESSION_RESPONSES.authenticated.body;

    expect(Object.keys(response).sort()).toEqual(schemas['SessionResponse'].required!.sort());
    expect<string[]>([...ACTOR_TYPES]).toEqual(
      schemas['SessionUser'].properties['actor_type'].enum!,
    );
  });

  it('declara Retry-After en la respuesta 429', () => {
    expect(operation.responses['429'].headers?.['Retry-After']?.schema['type']).toBe('integer');
  });

  it('los códigos de error del cliente son los que declara el contrato', () => {
    const declared = [401, 422, 429, 503, 504].flatMap(declaredCodes).sort();

    expect<string[]>(Object.values(CREATE_SESSION_ERROR_CODES).sort()).toEqual(declared);
  });

  for (const [name, response] of Object.entries(CREATE_SESSION_RESPONSES)) {
    it(`la respuesta simulada "${name}" (${response.status}) cumple el contrato`, () => {
      const schema = responseSchema(operation, response.status);

      expect(validateAgainstSchema(contract, schema, response.body)).toEqual([]);
      if (response.status >= 400) {
        expect(declaredCodes(response.status)).toContain((response.body as { code: string }).code);
      }
    });
  }
});
