import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import {
  MY_ROUTES_PATH,
  MY_ROUTES_RESPONSES,
  PUBLISH_ROUTE_RESPONSES,
  RETIRE_ROUTE_PATH,
  RETIRE_ROUTE_RESPONSES,
  ROUTES_NEXT_CURSOR,
  ROUTES_PATH,
  VALID_PUBLISH_ROUTE_REQUEST,
  organizerRoute,
} from '../../../../testing/bff-web/routes.fixtures';
import { SimulatedResponse } from '../../../../testing/bff-web/register-user.fixtures';
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
  BffWebRoutesApi,
  MY_ROUTES_ERROR_CODES,
  PUBLISH_ROUTE_ERROR_CODES,
  PublishRouteRequestDto,
  RETIRE_ROUTE_ERROR_CODES,
  ROUTE_COUNTRY_CODE_PATTERN,
  ROUTE_DIFFICULTIES,
  ROUTE_IDEMPOTENT_REPLAYED_HEADER,
  ROUTE_LIMITS,
  ROUTE_SPORTS,
  ROUTE_STATUSES,
  RouteResponseDto,
  RoutesResponseDto,
} from './routes.api';

type Schema = Record<string, unknown> & {
  properties: Record<string, Record<string, unknown>>;
  required: string[];
};

const contract = contractJson as unknown as OpenApiDocument;
const schemas = contract.components.schemas as Record<string, Schema>;
const operations = {
  publish: contract.paths[ROUTES_PATH]['post'],
  retire: contract.paths[RETIRE_ROUTE_PATH]['post'],
  list: contract.paths[MY_ROUTES_PATH]['get'],
} satisfies Record<string, OpenApiOperation>;

/**
 * Códigos declarados antes de los dos puntos, sin el texto entre paréntesis (motivos
 * de `details` y permisos).
 */
function declaredCodes(operation: OpenApiOperation, statuses: number[]): string[] {
  return statuses
    .flatMap((status) => {
      const description = operation.responses[String(status)]?.description ?? '';
      const codes = description.split(':')[0].replace(/\([^)]*\)/g, '');
      return [...codes.matchAll(/`([a-z_]+)`/g)].map((match) => match[1]);
    })
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

describe('Contrato bff-web: rutas del organizador (HU026, ADR-041)', () => {
  it('usa la versión del contrato y los operationId', () => {
    expect(contract.info.version).toBe(BFF_WEB_CONTRACT_VERSION);
    expect(operations.publish.operationId).toBe('publish_route_v1_routes_post');
    expect(operations.retire.operationId).toBe('retire_route_v1_routes__route_id__retire_post');
    expect(operations.list.operationId).toBe('my_routes_v1_me_routes_get');
  });

  it('publicar exige Idempotency-Key y expone Idempotent-Replayed; retirar y listar solo el token', () => {
    expect(headers(operations.publish)).toEqual([
      ['idempotency-key', 'true'],
      ['authorization', 'false'],
    ]);
    expect(Object.keys(operations.publish.responses['201'].headers ?? {})).toContain(
      ROUTE_IDEMPOTENT_REPLAYED_HEADER,
    );
    expect(headers(operations.retire)).toEqual([['authorization', 'false']]);
    expect(headers(operations.list)).toEqual([['authorization', 'false']]);
    expect(
      (operations.list.parameters ?? []).filter((p) => p.in === 'query').map((p) => p.name),
    ).toEqual(['limit', 'cursor']);
  });

  it('la solicitud del cliente cumple el esquema y rechaza organizer_id', () => {
    const schema = operations.publish.requestBody!.content['application/json'].schema;
    const body: PublishRouteRequestDto = VALID_PUBLISH_ROUTE_REQUEST;

    expect(validateAgainstSchema(contract, schema, body)).toEqual([]);
    expect(
      validateAgainstSchema(contract, schema, { ...body, description: null, waypoints: [] }),
    ).toEqual([]);
    expect(validateAgainstSchema(contract, schema, { ...body, organizer_id: 'x' })).toEqual([
      '$.organizer_id: propiedad no permitida',
    ]);
    expect(Object.keys(body).sort()).toEqual(
      Object.keys(schemas['PublishRouteRequest'].properties).sort(),
    );
    expect(requiredProperties('RetireRouteRequest')).toEqual(['expected_version']);
  });

  it('las respuestas del cliente tienen exactamente las propiedades obligatorias del contrato', () => {
    const route: RouteResponseDto = organizerRoute(0);
    const page: RoutesResponseDto = MY_ROUTES_RESPONSES.firstPage.body;

    expect(Object.keys(route).sort()).toEqual(requiredProperties('RouteResponse'));
    expect(Object.keys(page).sort()).toEqual(requiredProperties('RoutesResponse'));
    expect(Object.keys(route.start_point).sort()).toEqual(requiredProperties('RoutePoint'));
  });

  it('los catálogos cerrados y los límites coinciden con el contrato', () => {
    const body = schemas['PublishRouteRequest'].properties;
    const point = schemas['RoutePointRequest'].properties;
    const description = body['description']['anyOf'] as Record<string, unknown>[];

    expect<readonly string[]>(ROUTE_SPORTS).toEqual(schemas['Sport']['enum'] as string[]);
    expect<readonly string[]>(ROUTE_DIFFICULTIES).toEqual(
      schemas['Difficulty']['enum'] as string[],
    );
    expect<readonly string[]>(ROUTE_STATUSES).toEqual(
      schemas['RouteResponse'].properties['status']['enum'] as string[],
    );
    expect<number>(ROUTE_LIMITS.nameMin).toBe(body['name']['minLength'] as number);
    expect<number>(ROUTE_LIMITS.nameMax).toBe(body['name']['maxLength'] as number);
    expect<number>(ROUTE_LIMITS.descriptionMax).toBe(description[0]['maxLength'] as number);
    expect<number>(ROUTE_LIMITS.cityMin).toBe(body['city']['minLength'] as number);
    expect<number>(ROUTE_LIMITS.cityMax).toBe(body['city']['maxLength'] as number);
    expect<number>(ROUTE_LIMITS.waypointsMax).toBe(body['waypoints']['maxItems'] as number);
    expect<number>(ROUTE_LIMITS.latMin).toBe(point['lat']['minimum'] as number);
    expect<number>(ROUTE_LIMITS.latMax).toBe(point['lat']['maximum'] as number);
    expect<number>(ROUTE_LIMITS.lngMin).toBe(point['lng']['minimum'] as number);
    expect<number>(ROUTE_LIMITS.lngMax).toBe(point['lng']['maximum'] as number);
    expect(ROUTE_COUNTRY_CODE_PATTERN.source).toBe(body['country_code']['pattern'] as string);
    expect(body['distance_km']['description']).toContain(
      `entre \`${ROUTE_LIMITS.distanceMin}\` y \`${ROUTE_LIMITS.distanceMax}\``,
    );
    const limit = (operations.list.parameters ?? []).find((p) => p.name === 'limit')!;
    expect(limit.schema['description']).toContain(
      `de ${ROUTE_LIMITS.listMin} a ${ROUTE_LIMITS.listMax}; ${ROUTE_LIMITS.listDefault} por defecto`,
    );
  });

  it('los códigos de error del cliente son los que declaran las operaciones', () => {
    expect<string[]>(Object.values(PUBLISH_ROUTE_ERROR_CODES).sort()).toEqual(
      declaredCodes(operations.publish, [401, 403, 409, 422, 503, 504]),
    );
    expect<string[]>(Object.values(RETIRE_ROUTE_ERROR_CODES).sort()).toEqual(
      declaredCodes(operations.retire, [401, 403, 404, 409, 422, 503, 504]),
    );
    expect<string[]>(Object.values(MY_ROUTES_ERROR_CODES).sort()).toEqual(
      declaredCodes(operations.list, [401, 403, 422, 503, 504]),
    );
    expect(operations.retire.responses['409'].description).toContain(
      '`{field: expected_version, issue: <versión vigente>}`',
    );
  });

  it('las respuestas simuladas cumplen el contrato', () => {
    expectValid(operations.publish, PUBLISH_ROUTE_RESPONSES);
    expectValid(operations.retire, RETIRE_ROUTE_RESPONSES);
    expectValid(operations.list, MY_ROUTES_RESPONSES);
  });
});

describe('BffWebRoutesApi', () => {
  let api: BffWebRoutesApi;
  let http: HttpTestingController;
  const route = organizerRoute(0);

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
    api = TestBed.inject(BffWebRoutesApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('publica con token, Idempotency-Key y la respuesta completa', () => {
    let replayed: string | null = null;
    api
      .publishRoute('token-sintetico', VALID_PUBLISH_ROUTE_REQUEST, 'clave-uuid')
      .subscribe((response) => (replayed = response.headers.get('Idempotent-Replayed')));

    const request = http.expectOne('http://bff.test/v1/routes');
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-sintetico');
    expect(request.request.headers.get('Idempotency-Key')).toBe('clave-uuid');
    expect(request.request.body).toEqual(VALID_PUBLISH_ROUTE_REQUEST);
    request.flush(route, {
      status: 201,
      statusText: 'Created',
      headers: { 'Idempotent-Replayed': 'true' },
    });
    expect(replayed!).toBe('true');
  });

  it('retira con la versión esperada', () => {
    api.retireRoute('token-sintetico', route.route_id, { expected_version: 1 }).subscribe();

    const request = http.expectOne(`http://bff.test/v1/routes/${route.route_id}/retire`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ expected_version: 1 });
    request.flush(RETIRE_ROUTE_RESPONSES.retired.body);
  });

  it('lista con el tamaño y el cursor sin modificar', () => {
    const cursor = `${ROUTES_NEXT_CURSOR}+/=`;
    api.getMyRoutes('token-sintetico', { limit: 20, cursor }).subscribe();

    const request = http.expectOne((r) => r.url === 'http://bff.test/v1/me/routes');
    expect(request.request.params.get('limit')).toBe('20');
    expect(request.request.params.get('cursor')).toBe(cursor);
    request.flush(MY_ROUTES_RESPONSES.lastPage.body);
  });
});
