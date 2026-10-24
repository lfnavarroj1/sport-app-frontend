import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { SimulatedResponse } from '../../../../testing/bff-web/register-user.fixtures';
import {
  ASSOCIATE_SERVICE_RESPONSES,
  DISSOCIATE_SERVICE_RESPONSES,
  SERVICE_ASSOCIATIONS_NEXT_CURSOR,
  SERVICE_ASSOCIATIONS_PATH,
  SERVICE_ASSOCIATIONS_RESPONSES,
  SERVICE_ASSOCIATION_PATH,
  VALID_ASSOCIATE_SERVICE_REQUEST,
  serviceAssociation,
} from '../../../../testing/bff-web/service-associations.fixtures';
import {
  OpenApiDocument,
  OpenApiOperation,
  responseSchema,
  validateAgainstSchema,
} from '../../../../testing/openapi-schema';
import { APP_CONFIG } from '../../config/app-config';
import contractJson from '../contracts/bff-web.openapi.json';
import { BFF_WEB_CONTRACT_VERSION } from './contract';
import {
  ASSOCIATE_SERVICE_ERROR_CODES,
  ASSOCIATION_IDEMPOTENT_REPLAYED_HEADER,
  ASSOCIATION_STATUSES,
  ASSOCIATION_STATUS_FILTERS,
  AssociateServiceRequestDto,
  BffWebServiceAssociationsApi,
  DISSOCIATE_SERVICE_ERROR_CODES,
  SERVICE_ASSOCIATIONS_ERROR_CODES,
  SERVICE_ASSOCIATIONS_LIMITS,
  ServiceAssociationResponseDto,
  ServiceAssociationsResponseDto,
} from './service-associations.api';
import { SERVICE_CATEGORIES, SERVICE_MODALITIES } from './services-availability.api';

type Schema = Record<string, unknown> & {
  properties: Record<string, Record<string, unknown>>;
  required: string[];
};

const contract = contractJson as unknown as OpenApiDocument;
const schemas = contract.components.schemas as Record<string, Schema>;
const operations = {
  associate: contract.paths[SERVICE_ASSOCIATIONS_PATH]['post'],
  dissociate: contract.paths[SERVICE_ASSOCIATION_PATH]['delete'],
  list: contract.paths[SERVICE_ASSOCIATIONS_PATH]['get'],
} satisfies Record<string, OpenApiOperation>;

/**
 * Códigos declarados en las descripciones: los de cada tramo separado por «, o» o
 * «;», tomando solo lo anterior a los dos puntos (sin motivos de `details`).
 */
function declaredCodes(operation: OpenApiOperation, statuses: number[]): string[] {
  return statuses
    .flatMap((status) => {
      const description = operation.responses[String(status)]?.description ?? '';
      return description
        .split(/;|, o /)
        .map((part) => part.split(/:| con /)[0])
        .flatMap((part) => [...part.matchAll(/`([a-z_]+)`/g)].map((match) => match[1]));
    })
    .filter((code, index, all) => all.indexOf(code) === index)
    .sort();
}

function requiredProperties(schema: string): string[] {
  return [...schemas[schema].required].sort();
}

function headers(operation: OpenApiOperation): string[][] {
  return (operation.parameters ?? [])
    .filter((p) => p.in === 'header')
    .map((p) => [p.name.toLowerCase(), String(p.required ?? false)]);
}

function expectValid(operation: OpenApiOperation, responses: Record<string, SimulatedResponse>) {
  for (const [name, response] of Object.entries(responses)) {
    expect(
      validateAgainstSchema(contract, responseSchema(operation, response.status), response.body),
    )
      .withContext(`${name} (${response.status})`)
      .toEqual([]);
    if (response.status >= 400) {
      expect(declaredCodes(operation, [response.status]))
        .withContext(name)
        .toContain((response.body as { code: string }).code);
    }
  }
}

describe('Contrato bff-web: asociaciones a servicios médicos deportivos (HU017, ADR-038)', () => {
  it('usa la versión del contrato y los operationId', () => {
    expect(contract.info.version).toBe(BFF_WEB_CONTRACT_VERSION);
    expect(operations.associate.operationId).toBe('associate_v1_me_service_associations_post');
    expect(operations.dissociate.operationId).toBe(
      'dissociate_v1_me_service_associations__association_id__delete',
    );
    expect(operations.list.operationId).toBe('list_mine_v1_me_service_associations_get');
  });

  it('asociar lleva Idempotency-Key y expone Idempotent-Replayed; quitar y listar solo el token', () => {
    expect(headers(operations.associate)).toEqual([
      ['idempotency-key', 'false'],
      ['authorization', 'false'],
    ]);
    expect(operations.associate.parameters![0].schema['description']).toContain('obligatorio');
    expect(Object.keys(operations.associate.responses['201'].headers ?? {})).toContain(
      ASSOCIATION_IDEMPOTENT_REPLAYED_HEADER,
    );
    expect(headers(operations.dissociate)).toEqual([['authorization', 'false']]);
    expect(Object.keys(operations.dissociate.responses)).toContain('204');
    expect(headers(operations.list)).toEqual([['authorization', 'false']]);
    expect(
      (operations.list.parameters ?? []).filter((p) => p.in === 'query').map((p) => p.name),
    ).toEqual(['status', 'limit', 'cursor']);
  });

  it('la solicitud del cliente cumple el esquema y no admite campos de más', () => {
    const schema = operations.associate.requestBody!.content['application/json'].schema;
    const body: AssociateServiceRequestDto = VALID_ASSOCIATE_SERVICE_REQUEST;

    expect(validateAgainstSchema(contract, schema, body)).toEqual([]);
    expect(validateAgainstSchema(contract, schema, { ...body, athlete_id: 'x' })).toEqual([
      '$.athlete_id: propiedad no permitida',
    ]);
    expect(Object.keys(body)).toEqual(Object.keys(schema['properties'] as object));
  });

  it('las respuestas del cliente tienen exactamente las propiedades obligatorias del contrato', () => {
    const association: ServiceAssociationResponseDto = serviceAssociation(0);
    const page: ServiceAssociationsResponseDto = SERVICE_ASSOCIATIONS_RESPONSES.lastPage.body;

    expect(Object.keys(association).sort()).toEqual(
      requiredProperties('ServiceAssociationResponse'),
    );
    expect(Object.keys(association.service).sort()).toEqual(
      requiredProperties('AssociatedServiceSummary'),
    );
    expect(Object.keys(page).sort()).toEqual(requiredProperties('ServiceAssociationsResponse'));
  });

  it('los catálogos cerrados y los límites coinciden con el contrato', () => {
    const summary = schemas['AssociatedServiceSummary'].properties;
    expect<readonly string[]>(ASSOCIATION_STATUSES).toEqual(
      schemas['ServiceAssociationResponse'].properties['status']['enum'] as string[],
    );
    expect<readonly string[]>(SERVICE_CATEGORIES).toEqual(summary['category']['enum'] as string[]);
    expect<readonly string[]>(SERVICE_MODALITIES).toEqual(summary['modality']['enum'] as string[]);
    const query = (name: string) =>
      (operations.list.parameters ?? []).find((p) => p.name === name)!.schema['description'];
    for (const status of ASSOCIATION_STATUS_FILTERS) {
      expect(query('status')).toContain(`\`${status}\``);
    }
    expect(query('status')).toContain('`ACTIVE` (por defecto)');
    expect(query('limit')).toContain(
      `de ${SERVICE_ASSOCIATIONS_LIMITS.listMin} a ${SERVICE_ASSOCIATIONS_LIMITS.listMax}; ${SERVICE_ASSOCIATIONS_LIMITS.listDefault} por defecto`,
    );
  });

  it('los códigos de error del cliente son los que declaran las operaciones', () => {
    expect<string[]>(Object.values(ASSOCIATE_SERVICE_ERROR_CODES).sort()).toEqual(
      declaredCodes(operations.associate, [401, 403, 404, 409, 422, 503, 504]),
    );
    expect<string[]>(Object.values(DISSOCIATE_SERVICE_ERROR_CODES).sort()).toEqual(
      declaredCodes(operations.dissociate, [401, 403, 404, 422, 503, 504]),
    );
    expect<string[]>(Object.values(SERVICE_ASSOCIATIONS_ERROR_CODES).sort()).toEqual(
      declaredCodes(operations.list, [401, 403, 422, 503, 504]),
    );
    expect(operations.associate.responses['409'].description).toContain(
      '`association_exists` con `details: [{field: "association_id", issue: <identificador de la activa>}]`',
    );
  });

  it('las respuestas simuladas cumplen el contrato', () => {
    expectValid(operations.associate, ASSOCIATE_SERVICE_RESPONSES);
    expectValid(operations.dissociate, DISSOCIATE_SERVICE_RESPONSES);
    expectValid(operations.list, SERVICE_ASSOCIATIONS_RESPONSES);
  });
});

describe('BffWebServiceAssociationsApi', () => {
  let api: BffWebServiceAssociationsApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: APP_CONFIG,
          useValue: {
            environment: 'test',
            bffWebBaseUrl: 'http://bff.test/',
            registrationPoliciesVersion: null,
            healthDataConsentVersion: null,
          },
        },
      ],
    });
    api = TestBed.inject(BffWebServiceAssociationsApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('asocia con token, Idempotency-Key y la respuesta completa', () => {
    let replayed: string | null = null;
    api
      .associate('token-sintetico', VALID_ASSOCIATE_SERVICE_REQUEST, 'clave-uuid')
      .subscribe((response) => (replayed = response.headers.get('Idempotent-Replayed')));

    const request = http.expectOne('http://bff.test/v1/me/service-associations');
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-sintetico');
    expect(request.request.headers.get('Idempotency-Key')).toBe('clave-uuid');
    expect(request.request.body).toEqual(VALID_ASSOCIATE_SERVICE_REQUEST);
    request.flush(ASSOCIATE_SERVICE_RESPONSES.created.body, {
      status: 201,
      statusText: 'Created',
      headers: { 'Idempotent-Replayed': 'true' },
    });
    expect(replayed!).toBe('true');
  });

  it('quita la asociación con DELETE y solo el token', () => {
    const id = serviceAssociation(0).association_id;
    api.dissociate('token-sintetico', id).subscribe();

    const request = http.expectOne(`http://bff.test/v1/me/service-associations/${id}`);
    expect(request.request.method).toBe('DELETE');
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-sintetico');
    expect(request.request.headers.has('Idempotency-Key')).toBeFalse();
    request.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('lista con el estado, el tamaño y el cursor sin modificar', () => {
    const cursor = `${SERVICE_ASSOCIATIONS_NEXT_CURSOR}+/=`;
    api.listMine('token-sintetico', { status: 'ALL', limit: 20, cursor }).subscribe();

    const request = http.expectOne((r) => r.url === 'http://bff.test/v1/me/service-associations');
    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('status')).toBe('ALL');
    expect(request.request.params.get('limit')).toBe('20');
    expect(request.request.params.get('cursor')).toBe(cursor);
    expect(request.request.urlWithParams).toContain(
      'cursor=cursor-sintetico-asociaciones-20%2B%2F%3D',
    );
    request.flush(SERVICE_ASSOCIATIONS_RESPONSES.lastPage.body);
  });

  it('no envía los parámetros ausentes', () => {
    api.listMine('token-sintetico', { cursor: null }).subscribe();

    const request = http.expectOne((r) => r.url === 'http://bff.test/v1/me/service-associations');
    expect(request.request.params.keys()).toEqual([]);
    request.flush(SERVICE_ASSOCIATIONS_RESPONSES.empty.body);
  });
});
