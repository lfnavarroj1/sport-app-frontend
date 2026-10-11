import {
  REGISTER_USER_PATH,
  REGISTER_USER_RESPONSES,
  VALID_REGISTER_USER_REQUEST,
} from '../../../../testing/bff-web/register-user.fixtures';
import {
  OpenApiDocument,
  OpenApiOperation,
  responseSchema,
  validateAgainstSchema,
} from '../../../../testing/openapi-schema';
import contractJson from '../contracts/bff-web.openapi.json';
import {
  ACTOR_TYPES,
  BFF_WEB_CONTRACT_VERSION,
  REGISTER_USER_ERROR_CODES,
  RegisterUserRequestDto,
} from './users.api';

const contract = contractJson as unknown as OpenApiDocument;
const operation: OpenApiOperation = contract.paths[REGISTER_USER_PATH]['post'];
const requestSchema = operation.requestBody!.content['application/json'].schema;
const registerUserRequest = contract.components.schemas['RegisterUserRequest'] as {
  properties: Record<string, { enum?: string[] }>;
};

/** Códigos de error declarados en la descripción de cada respuesta del contrato. */
function declaredCodes(status: number): string[] {
  const description = operation.responses[String(status)]?.description ?? '';
  return [...description.matchAll(/`([a-z_]+)`/g)].map((match) => match[1]);
}

describe('Contrato bff-web: POST /v1/users (HU001)', () => {
  it('usa la versión del contrato que declaran los modelos de transporte', () => {
    expect(contract.info.version).toBe(BFF_WEB_CONTRACT_VERSION);
    expect(operation.operationId).toBe('register_v1_users_post');
  });

  it('exige Idempotency-Key como UUID en la cabecera', () => {
    const header = operation.parameters?.find((parameter) => parameter.name === 'Idempotency-Key');

    expect(header?.in).toBe('header');
    expect(header?.required).toBeTrue();
    expect(header?.schema['format']).toBe('uuid');
  });

  it('el catálogo de tipos de actor coincide con el enum del contrato', () => {
    expect<string[]>([...ACTOR_TYPES]).toEqual(registerUserRequest.properties['actor_type'].enum!);
  });

  it('la solicitud del cliente tiene exactamente las propiedades del contrato', () => {
    const request: RegisterUserRequestDto = VALID_REGISTER_USER_REQUEST;

    expect(Object.keys(request).sort()).toEqual(Object.keys(registerUserRequest.properties).sort());
    expect(validateAgainstSchema(contract, requestSchema, request)).toEqual([]);
  });

  it('los códigos de error del cliente son los que declara el contrato', () => {
    const declared = [409, 422, 503, 504].flatMap(declaredCodes).sort();

    expect<string[]>(Object.values(REGISTER_USER_ERROR_CODES).sort()).toEqual(declared);
  });

  for (const [name, response] of Object.entries(REGISTER_USER_RESPONSES)) {
    it(`la respuesta simulada "${name}" (${response.status}) cumple el contrato`, () => {
      const schema = responseSchema(operation, response.status);

      expect(validateAgainstSchema(contract, schema, response.body)).toEqual([]);
      if (response.status >= 400) {
        expect(declaredCodes(response.status)).toContain((response.body as { code: string }).code);
      }
    });
  }

  it('el validador detecta respuestas que incumplen el contrato', () => {
    const withoutId: Record<string, unknown> = { ...REGISTER_USER_RESPONSES.registered.body };
    delete withoutId['user_id'];

    expect(validateAgainstSchema(contract, responseSchema(operation, 201), withoutId)).toEqual([
      '$.user_id: es obligatorio',
    ]);
    expect(
      validateAgainstSchema(contract, requestSchema, {
        ...VALID_REGISTER_USER_REQUEST,
        password: 'corta',
        actor_type: 'admin',
        extra: true,
      }),
    ).toEqual([
      '$.password: menos de 12 caracteres',
      '$.actor_type: "admin" no está en el enum',
      '$.extra: propiedad no permitida',
    ]);
  });
});
