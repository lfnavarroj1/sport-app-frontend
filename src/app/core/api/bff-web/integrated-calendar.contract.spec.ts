import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import {
  ASSOCIATED_SERVICE_ITEM,
  INTEGRATED_CALENDAR_PATH,
  INTEGRATED_CALENDAR_RESPONSES,
  MARCH_2027,
  OWN_DRAFT_ITEM,
  OWN_SERVICE_PUBLISHED_ITEM,
  PUBLISHED_EVENT_ITEM,
  REGISTRATION_ITEM,
  TRAINING_SESSION_ITEM,
} from '../../../../testing/bff-web/integrated-calendar.fixtures';
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
  BffWebIntegratedCalendarApi,
  INTEGRATED_CALENDAR_ERROR_CODES,
  INTEGRATED_CALENDAR_ISSUES,
  INTEGRATED_CALENDAR_SOURCES,
  INTEGRATED_ITEM_STATUSES,
  INTEGRATED_SOURCE_STATUSES,
  IntegratedAssociatedServiceAvailabilityItemDto,
  IntegratedCalendarResponseDto,
  IntegratedEventRegistrationItemDto,
  IntegratedOwnEventItemDto,
  IntegratedOwnServiceAvailabilityItemDto,
  IntegratedPublishedEventItemDto,
  IntegratedTrainingSessionItemDto,
} from './integrated-calendar.api';

const contract = contractJson as unknown as OpenApiDocument;
const schemas = contract.components.schemas as Record<string, Record<string, unknown>>;
const operation: OpenApiOperation = contract.paths[INTEGRATED_CALENDAR_PATH]['get'];

const itemsSchema = (
  schemas['IntegratedCalendarResponse']['properties'] as Record<string, Record<string, unknown>>
)['items']['items'] as {
  discriminator: { propertyName: string; mapping: Record<string, string> };
  oneOf: { $ref: string }[];
};

/** Esquema del elemento según su `source` (el validador de pruebas no evalúa `oneOf`). */
function itemSchema(source: string): Record<string, unknown> {
  return { $ref: itemsSchema.discriminator.mapping[source] };
}

function declaredCodes(statuses: number[]): string[] {
  return statuses
    .flatMap((status) => {
      const description = operation.responses[String(status)]?.description ?? '';
      const codes = description.split(':')[0].replace(/\([^)]*\)/g, '');
      return [...codes.matchAll(/`([a-z_]+)`/g)].map((match) => match[1]);
    })
    .sort();
}

function requiredProperties(schema: string): string[] {
  return [...(schemas[schema]['required'] as string[])].sort();
}

function property(schema: string, name: string): Record<string, unknown> {
  return (schemas[schema]['properties'] as Record<string, Record<string, unknown>>)[name];
}

describe('Contrato bff-web: operación de HU018', () => {
  it('usa la versión del contrato y su operationId', () => {
    expect(contract.info.version).toBe(BFF_WEB_CONTRACT_VERSION);
    expect(operation.operationId).toBe('integrated_calendar_v1_me_integrated_calendar_get');
  });

  it('se autentica con Authorization y recibe el periodo `from`/`to`', () => {
    const parameters = operation.parameters ?? [];
    expect(
      parameters.filter((p) => p.in === 'header').map((p) => p.name.toLowerCase()),
    ).toEqual(['authorization']);
    expect(parameters.filter((p) => p.in === 'query').map((p) => p.name)).toEqual(['from', 'to']);
  });

  it('las fuentes, sus estados y los estados de los elementos son los del contrato', () => {
    const statuses = itemsSchema.oneOf.flatMap(({ $ref }) => {
      const status = property($ref.replace('#/components/schemas/', ''), 'status');
      return (status['enum'] as string[] | undefined) ?? [status['const'] as string];
    });

    expect<string[]>([...INTEGRATED_CALENDAR_SOURCES]).toEqual(
      property('IntegratedSource', 'name')['enum'] as string[],
    );
    expect<string[]>([...INTEGRATED_SOURCE_STATUSES]).toEqual(
      property('IntegratedSource', 'status')['enum'] as string[],
    );
    expect<string[]>([...INTEGRATED_CALENDAR_SOURCES].sort()).toEqual(
      Object.keys(itemsSchema.discriminator.mapping).sort(),
    );
    expect<string[]>([...INTEGRATED_ITEM_STATUSES].sort()).toEqual([...new Set(statuses)].sort());
  });

  it('los modelos de transporte tienen exactamente las propiedades obligatorias del contrato', () => {
    const response: IntegratedCalendarResponseDto = INTEGRATED_CALENDAR_RESPONSES.athlete.body;
    const own: IntegratedOwnEventItemDto = OWN_DRAFT_ITEM;
    const published: IntegratedPublishedEventItemDto = PUBLISHED_EVENT_ITEM;
    const registration: IntegratedEventRegistrationItemDto = REGISTRATION_ITEM;
    const session: IntegratedTrainingSessionItemDto = TRAINING_SESSION_ITEM;
    const service: IntegratedOwnServiceAvailabilityItemDto = OWN_SERVICE_PUBLISHED_ITEM;
    const associated: IntegratedAssociatedServiceAvailabilityItemDto = ASSOCIATED_SERVICE_ITEM;

    expect(Object.keys(response).sort()).toEqual(requiredProperties('IntegratedCalendarResponse'));
    expect(Object.keys(response.sources[0]).sort()).toEqual(requiredProperties('IntegratedSource'));
    for (const [schema, item] of [
      ['IntegratedOwnEventItem', own],
      ['IntegratedPublishedEventItem', published],
      ['IntegratedEventRegistrationItem', registration],
      ['IntegratedTrainingSessionItem', session],
      ['IntegratedOwnServiceAvailabilityItem', service],
      ['IntegratedAssociatedServiceAvailabilityItem', associated],
    ] as const) {
      expect(Object.keys(item).sort()).withContext(schema).toEqual(requiredProperties(schema));
    }
    expect(Object.keys(own.location).sort()).toEqual(requiredProperties('IntegratedLocation'));
  });

  it('el 422 declara los motivos de `details[].issue` del cliente', () => {
    const description = operation.responses['422'].description;
    const issues = [...description.split(':')[1].matchAll(/`([a-z_]+)`/g)].map((m) => m[1]);

    expect<string[]>([...INTEGRATED_CALENDAR_ISSUES]).toEqual(issues);
  });

  it('los códigos de error del cliente son los que declara el contrato', () => {
    expect<string[]>(Object.values(INTEGRATED_CALENDAR_ERROR_CODES).sort()).toEqual(
      declaredCodes([401, 403, 422, 503, 504]),
    );
  });

  for (const [key, response] of Object.entries(INTEGRATED_CALENDAR_RESPONSES)) {
    it(`la respuesta simulada "${key}" (${response.status}) cumple el contrato`, () => {
      expect(
        validateAgainstSchema(contract, responseSchema(operation, response.status), response.body),
      ).toEqual([]);
      if (response.status === 200) {
        const body = response.body as IntegratedCalendarResponseDto;
        body.items.forEach((item, index) =>
          expect(validateAgainstSchema(contract, itemSchema(item.source), item, `$.items[${index}]`))
            .withContext(item.item_id)
            .toEqual([]),
        );
      } else {
        expect(declaredCodes([response.status])).toContain(
          (response.body as { code: string }).code,
        );
      }
    });
  }
});

describe('BffWebIntegratedCalendarApi (HU018)', () => {
  let api: BffWebIntegratedCalendarApi;
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
    api = TestBed.inject(BffWebIntegratedCalendarApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('consulta el calendario del actor con el periodo y el access token', () => {
    let body: IntegratedCalendarResponseDto | undefined;
    api.getIntegratedCalendar('token-sintetico', MARCH_2027).subscribe((value) => (body = value));

    const request = http.expectOne((r) => r.url === 'http://bff.test/v1/me/integrated-calendar');
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-sintetico');
    expect(request.request.urlWithParams).toBe(
      'http://bff.test/v1/me/integrated-calendar?from=2027-03-01T05%3A00%3A00Z&to=2027-04-01T05%3A00%3A00Z',
    );
    request.flush(INTEGRATED_CALENDAR_RESPONSES.organizer.body);
    expect(body).toEqual(INTEGRATED_CALENDAR_RESPONSES.organizer.body);
  });

  it('codifica el desfase de un instante con zona (`+`) sin alterarlo', () => {
    api
      .getIntegratedCalendar('token-sintetico', {
        from: '2027-03-01T00:00:00+05:30',
        to: '2027-03-08T00:00:00+05:30',
      })
      .subscribe();

    const request = http.expectOne((r) => r.url === 'http://bff.test/v1/me/integrated-calendar');
    expect(request.request.urlWithParams).toContain('from=2027-03-01T00%3A00%3A00%2B05%3A30');
    request.flush(INTEGRATED_CALENDAR_RESPONSES.organizerEmpty.body);
  });
});
