import {
  GET_CAPABILITIES_PATH,
  GET_CAPABILITIES_RESPONSES,
  capabilitiesFor,
} from '../../../../testing/bff-web/capabilities.fixtures';
import {
  OpenApiDocument,
  OpenApiOperation,
  responseSchema,
  validateAgainstSchema,
} from '../../../../testing/openapi-schema';
import contractJson from '../contracts/bff-web.openapi.json';
import {
  CapabilitiesResponseDto,
  GET_CAPABILITIES_ERROR_CODES,
  SUBSCRIPTION_STATUSES,
} from './capabilities.api';
import { ACTOR_TYPES } from './contract';

const contract = contractJson as unknown as OpenApiDocument;
const operation: OpenApiOperation = contract.paths[GET_CAPABILITIES_PATH]['get'];
const schema = contract.components.schemas['CapabilitiesResponse'] as {
  properties: Record<string, { enum?: string[] }>;
  required: string[];
};

function declaredCodes(status: number): string[] {
  const description = operation.responses[String(status)]?.description ?? '';
  return [...description.matchAll(/`([a-z_]+)`/g)].map((match) => match[1]);
}

describe('Contrato bff-web: GET /v1/me/capabilities (HU003, ADR-024)', () => {
  it('corresponde a la operación de capacidades y se autentica con la cabecera Authorization', () => {
    expect(operation.operationId).toBe('get_capabilities_v1_me_capabilities_get');
    expect(operation.requestBody).toBeUndefined();
    expect((operation.parameters ?? []).map((p) => [p.in, p.name.toLowerCase()])).toEqual([
      ['header', 'authorization'],
    ]);
  });

  it('el modelo de respuesta tiene exactamente las propiedades obligatorias del contrato', () => {
    const response: CapabilitiesResponseDto = GET_CAPABILITIES_RESPONSES.athleteFree.body;

    expect(Object.keys(response).sort()).toEqual([...schema.required].sort());
    expect<string[]>([...ACTOR_TYPES]).toEqual(schema.properties['actor_type'].enum!);
    expect<string[]>([...SUBSCRIPTION_STATUSES]).toEqual(
      schema.properties['subscription_status'].enum!,
    );
  });

  it('los códigos de error del cliente son los que declara el contrato', () => {
    const declared = [401, 403, 503].flatMap(declaredCodes).sort();

    expect<string[]>(Object.values(GET_CAPABILITIES_ERROR_CODES).sort()).toEqual(declared);
  });

  it('el simulador entrega a cada actor la vista de su tipo y rechaza uno desconocido', () => {
    for (const actor of ACTOR_TYPES) {
      const response = capabilitiesFor(actor);
      expect(response.status).toBe(200);
      expect((response.body as CapabilitiesResponseDto).actor_type).toBe(actor);
    }
    expect(capabilitiesFor('admin')).toBe(GET_CAPABILITIES_RESPONSES.unsupportedActorType);
  });

  for (const [name, response] of Object.entries(GET_CAPABILITIES_RESPONSES)) {
    it(`la respuesta simulada "${name}" (${response.status}) cumple el contrato`, () => {
      expect(
        validateAgainstSchema(contract, responseSchema(operation, response.status), response.body),
      ).toEqual([]);
      if (response.status >= 400) {
        expect(declaredCodes(response.status)).toContain((response.body as { code: string }).code);
      }
    });
  }
});
