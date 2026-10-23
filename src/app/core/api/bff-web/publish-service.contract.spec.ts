import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import {
  MY_SERVICE_RESPONSES,
  MY_SERVICES_PATH,
  MY_SERVICES_RESPONSES,
  PUBLISH_SERVICE_RESPONSES,
  SIMULATED_PUBLISH_SERVICE_ID,
} from '../../../../testing/bff-web/publish-service.fixtures';
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
  BffWebServicesApi,
  MY_SERVICE_ERROR_CODES,
  MY_SERVICES_ERROR_CODES,
  MY_SERVICES_LIMIT,
  MyServicesResponseDto,
  PUBLISH_SERVICE_ERROR_CODES,
  PublishServiceResponseDto,
  SERVICE_IDEMPOTENT_REPLAYED_HEADER,
  ServiceResponseDto,
} from './services.api';

const contract = contractJson as unknown as OpenApiDocument;
const schemas = contract.components.schemas as Record<string, Record<string, unknown>>;
const operations = {
  mine: contract.paths[MY_SERVICES_PATH]['get'],
  detail: contract.paths['/v1/me/services/{service_id}']['get'],
  publish: contract.paths['/v1/services/{service_id}/publish']['post'],
} satisfies Record<string, OpenApiOperation>;

/**
 * Código declarado en cada respuesta: la descripción empieza por él; lo que sigue
 * cita parámetros, permisos o motivos (`query.status`, `services.publish`…).
 */
function declaredCodes(operation: OpenApiOperation, statuses: number[]): string[] {
  return statuses
    .map((status) => /^`([a-z_]+)`/.exec(operation.responses[String(status)]?.description ?? ''))
    .filter((match) => match !== null)
    .map((match) => match[1])
    .sort();
}

function parameterNames(operation: OpenApiOperation): string[] {
  return (operation.parameters ?? []).map((item) => `${item.in}:${item.name.toLowerCase()}`);
}

function parameterDescription(name: string): string {
  return (operations.mine.parameters!.find((item) => item.name === name)!.schema['description'] ??
    '') as string;
}

function required(schema: string): string[] {
  return [...(schemas[schema]['required'] as string[])].sort();
}

describe('Contrato bff-web: operaciones de HU019 (ADR-027)', () => {
  it('usa la versión del contrato y sus operationId', () => {
    expect(contract.info.version).toBe(BFF_WEB_CONTRACT_VERSION);
    expect(operations.mine.operationId).toBe('list_mine_v1_me_services_get');
    expect(operations.detail.operationId).toBe('get_mine_v1_me_services__service_id__get');
    expect(operations.publish.operationId).toBe('publish_v1_services__service_id__publish_post');
  });

  it('acepta exactamente los parámetros y cabeceras del contrato; publicar va sin cuerpo', () => {
    expect(parameterNames(operations.mine)).toEqual([
      'query:status',
      'query:limit',
      'query:cursor',
      'header:authorization',
    ]);
    expect(parameterNames(operations.detail)).toEqual(['path:service_id', 'header:authorization']);
    expect(parameterNames(operations.publish)).toEqual([
      'path:service_id',
      'header:idempotency-key',
      'header:authorization',
    ]);
    expect(operations.publish.requestBody).toBeUndefined();
  });

  it('el filtro de estado y el límite coinciden con lo que declara el contrato', () => {
    expect(parameterDescription('status')).toContain('`DRAFT` o `PUBLISHED`');
    expect(parameterDescription('limit')).toBe(
      `Entero de ${MY_SERVICES_LIMIT.min} a ${MY_SERVICES_LIMIT.max}; ${MY_SERVICES_LIMIT.default} por defecto.`,
    );
  });

  it('los modelos tienen exactamente las propiedades obligatorias del contrato', () => {
    const page: MyServicesResponseDto = MY_SERVICES_RESPONSES.firstPage.body;
    const service: ServiceResponseDto = MY_SERVICE_RESPONSES.draft.body;
    const published: PublishServiceResponseDto = PUBLISH_SERVICE_RESPONSES.published.body;

    expect(Object.keys(page).sort()).toEqual(required('MyServicesResponse'));
    expect(Object.keys(page.items[0]).sort()).toEqual(required('ServiceResponse'));
    expect(Object.keys(service).sort()).toEqual(required('ServiceResponse'));
    expect(Object.keys(published).sort()).toEqual(required('PublishServiceResponse'));
  });

  it('publicar declara Idempotent-Replayed en el 200', () => {
    expect(Object.keys(operations.publish.responses['200'].headers ?? {})).toEqual([
      SERVICE_IDEMPOTENT_REPLAYED_HEADER,
    ]);
  });

  it('los códigos de error del cliente son los que declara el contrato', () => {
    expect<string[]>(Object.values(MY_SERVICES_ERROR_CODES).sort()).toEqual(
      declaredCodes(operations.mine, [401, 403, 422, 503, 504]),
    );
    expect<string[]>(Object.values(MY_SERVICE_ERROR_CODES).sort()).toEqual(
      declaredCodes(operations.detail, [401, 403, 404, 422, 503, 504]),
    );
    expect<string[]>(Object.values(PUBLISH_SERVICE_ERROR_CODES).sort()).toEqual(
      declaredCodes(operations.publish, [401, 403, 404, 409, 422, 503, 504]),
    );
  });

  const cases: [string, OpenApiOperation, Record<string, { status: number; body: unknown }>][] = [
    ['GET /v1/me/services', operations.mine, MY_SERVICES_RESPONSES],
    ['GET /v1/me/services/{service_id}', operations.detail, MY_SERVICE_RESPONSES],
    ['POST /v1/services/{service_id}/publish', operations.publish, PUBLISH_SERVICE_RESPONSES],
  ];
  for (const [label, operation, responses] of cases) {
    for (const [name, response] of Object.entries(responses)) {
      it(`${label}: la respuesta simulada "${name}" (${response.status}) cumple el contrato`, () => {
        expect(
          validateAgainstSchema(
            contract,
            responseSchema(operation, response.status),
            response.body,
          ),
        ).toEqual([]);
        if (response.status >= 400) {
          expect(declaredCodes(operation, [response.status])).toContain(
            (response.body as { code: string }).code,
          );
        }
      });
    }
  }
});

describe('BffWebServicesApi (HU019)', () => {
  let api: BffWebServicesApi;
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
          },
        },
      ],
    });
    api = TestBed.inject(BffWebServicesApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lista los servicios propios con estado, límite y el cursor opaco sin modificarlo', () => {
    api
      .getMyServices('token-sintetico', { status: 'DRAFT', limit: 20, cursor: 'abc+/=' })
      .subscribe();

    const request = http.expectOne((r) => r.url === 'http://bff.test/v1/me/services');
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-sintetico');
    expect(request.request.params.keys().sort()).toEqual(['cursor', 'limit', 'status']);
    expect(request.request.urlWithParams).toContain('cursor=abc%2B%2F%3D');
    request.flush(MY_SERVICES_RESPONSES.lastPage.body);
  });

  it('consulta el servicio propio por service_id', () => {
    api.getMyService('token-sintetico', SIMULATED_PUBLISH_SERVICE_ID).subscribe();

    const request = http.expectOne(
      `http://bff.test/v1/me/services/${SIMULATED_PUBLISH_SERVICE_ID}`,
    );
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-sintetico');
    request.flush(MY_SERVICE_RESPONSES.draft.body);
  });

  it('publica sin cuerpo, con token e Idempotency-Key', () => {
    api.publishService('token-sintetico', SIMULATED_PUBLISH_SERVICE_ID, 'clave-1').subscribe();

    const request = http.expectOne(
      `http://bff.test/v1/services/${SIMULATED_PUBLISH_SERVICE_ID}/publish`,
    );
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toBeNull();
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-sintetico');
    expect(request.request.headers.get('Idempotency-Key')).toBe('clave-1');
    request.flush(PUBLISH_SERVICE_RESPONSES.published.body);
  });
});
