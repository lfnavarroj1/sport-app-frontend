import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import {
  SERVICES_AVAILABILITY_PATH,
  SERVICES_AVAILABILITY_RESPONSES,
} from '../../../../testing/bff-web/services-availability.fixtures';
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
  BILLING_UNITS,
  BffWebServicesAvailabilityApi,
  CatalogServiceDto,
  SERVICES_AVAILABILITY_ERROR_CODES,
  SERVICE_CATEGORIES,
  SERVICE_MODALITIES,
  ServiceAvailabilityResponseDto,
} from './services-availability.api';

const contract = contractJson as unknown as OpenApiDocument;
const operation: OpenApiOperation = contract.paths[SERVICES_AVAILABILITY_PATH]['get'];
const schemas = contract.components.schemas as Record<
  string,
  { properties: Record<string, Record<string, unknown>>; required: string[] }
>;

/** Códigos de error declarados en la descripción de cada respuesta. */
function declaredCodes(status: number): string[] {
  const description = operation.responses[String(status)]?.description ?? '';
  return [...description.matchAll(/`([a-z_]+)`/g)].map((match) => match[1]);
}

describe('Contrato bff-web: GET /v1/services/availability (HU020, ADR-038)', () => {
  it('usa la versión del contrato y su operationId', () => {
    expect(contract.info.version).toBe(BFF_WEB_CONTRACT_VERSION);
    expect(operation.operationId).toBe('availability_v1_services_availability_get');
  });

  it('acepta periodo, filtros repetibles, disponibilidad, página y cursor con Authorization', () => {
    expect((operation.parameters ?? []).map((p) => `${p.in}:${p.name.toLowerCase()}`)).toEqual([
      'query:from',
      'query:to',
      'query:category',
      'query:modality',
      'query:availability',
      'query:limit',
      'query:cursor',
      'header:authorization',
    ]);
    const repeatable = (name: string) =>
      (
        operation.parameters!.find((p) => p.name === name)!.schema['anyOf'] as {
          type: string;
        }[]
      )[0].type;
    expect(repeatable('category')).toBe('array');
    expect(repeatable('modality')).toBe('array');
  });

  it('las enumeraciones del cliente coinciden con el contrato', () => {
    const service = schemas['CatalogService'].properties;
    const price = schemas['ServicePrice'].properties;

    expect<string[]>([...SERVICE_CATEGORIES]).toEqual(service['category']['enum'] as string[]);
    expect<string[]>([...SERVICE_MODALITIES]).toEqual(service['modality']['enum'] as string[]);
    expect<string[]>([...BILLING_UNITS]).toEqual(price['billing_unit']['enum'] as string[]);
  });

  it('los modelos tienen exactamente las propiedades obligatorias del contrato', () => {
    const response: ServiceAvailabilityResponseDto = SERVICES_AVAILABILITY_RESPONSES.firstPage.body;
    const service: CatalogServiceDto = response.items[0];

    expect(Object.keys(response).sort()).toEqual(
      [...schemas['ServiceAvailabilityResponse'].required].sort(),
    );
    expect(Object.keys(service).sort()).toEqual([...schemas['CatalogService'].required].sort());
    expect(Object.keys(service.price).sort()).toEqual([...schemas['ServicePrice'].required].sort());
    expect(Object.keys(service.availability[0]).sort()).toEqual(
      [...schemas['AvailabilityInterval'].required].sort(),
    );
  });

  it('los códigos de error del cliente son los que declara el contrato', () => {
    const declared = [401, 403, 422, 503, 504].flatMap(declaredCodes).sort();

    expect<string[]>(Object.values(SERVICES_AVAILABILITY_ERROR_CODES).sort()).toEqual(declared);
  });

  for (const [name, response] of Object.entries(SERVICES_AVAILABILITY_RESPONSES)) {
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

describe('BffWebServicesAvailabilityApi', () => {
  let api: BffWebServicesAvailabilityApi;
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
    api = TestBed.inject(BffWebServicesAvailabilityApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('envía el periodo, repite category y modality y codifica el cursor opaco', () => {
    api
      .getAvailability('token-sintetico', {
        from: '2026-11-03T00:00:00-05:00',
        to: '2026-11-10T00:00:00-05:00',
        category: ['COACHING', 'NUTRITION'],
        modality: ['VIRTUAL'],
        availability: 'all',
        limit: 20,
        cursor: 'abc+/=',
      })
      .subscribe();

    const request = http.expectOne((r) => r.url === 'http://bff.test/v1/services/availability');
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-sintetico');
    expect(request.request.params.getAll('category')).toEqual(['COACHING', 'NUTRITION']);
    expect(request.request.params.getAll('modality')).toEqual(['VIRTUAL']);
    expect(request.request.params.get('availability')).toBe('all');
    expect(request.request.params.get('limit')).toBe('20');
    expect(request.request.urlWithParams).toContain('from=2026-11-03T00%3A00%3A00-05%3A00');
    expect(request.request.urlWithParams).toContain('cursor=abc%2B%2F%3D');
    request.flush(SERVICES_AVAILABILITY_RESPONSES.firstPage.body);
  });

  it('omite los filtros que no se indican', () => {
    api
      .getAvailability('token-sintetico', {
        from: '2026-11-03T00:00:00-05:00',
        to: '2026-11-04T00:00:00-05:00',
      })
      .subscribe();

    const request = http.expectOne((r) => r.url === 'http://bff.test/v1/services/availability');
    expect(request.request.params.keys()).toEqual(['from', 'to']);
    request.flush(SERVICES_AVAILABILITY_RESPONSES.empty.body);
  });
});
