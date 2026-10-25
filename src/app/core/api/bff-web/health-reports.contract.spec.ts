import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import {
  HEALTH_REPORTS_RESPONSES,
  MY_HEALTH_REPORTS_PATH,
  SIMULATED_HEALTH_ATHLETE_ID,
} from '../../../../testing/bff-web/health-reports.fixtures';
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
  BffWebHealthReportsApi,
  HEALTH_BODY_AREAS,
  HEALTH_REPORTS_ERROR_CODES,
  HEALTH_REPORTS_LIMIT,
  HEALTH_REPORT_STATUSES,
  HEALTH_REPORT_TYPES,
  HEALTH_SEVERITIES,
  HealthReportHistoryItemDto,
  HealthReportHistoryResponseDto,
} from './health-reports.api';

const contract = contractJson as unknown as OpenApiDocument;
const schemas = contract.components.schemas as Record<string, Record<string, unknown>>;
const operations = {
  own: contract.paths[MY_HEALTH_REPORTS_PATH]['get'],
  athlete: contract.paths['/v1/athletes/{athlete_id}/health-reports']['get'],
} satisfies Record<string, OpenApiOperation>;

function declaredCodes(operation: OpenApiOperation, statuses: number[]): string[] {
  return statuses
    .flatMap((status) => {
      const description = operation.responses[String(status)]?.description ?? '';
      return [...description.matchAll(/`([a-z_]+)`/g)].map((match) => match[1]);
    })
    .sort();
}

function parameter(operation: OpenApiOperation, name: string) {
  return operation.parameters!.find((item) => item.name === name)!;
}

function enumOf(name: string): string[] {
  return schemas[name]['enum'] as string[];
}

describe('Contrato bff-web: consultas de HU012 (ADR-037)', () => {
  it('usa la versión del contrato y sus operationId', () => {
    expect(contract.info.version).toBe(BFF_WEB_CONTRACT_VERSION);
    expect(operations.own.operationId).toBe('own_reports_v1_me_health_reports_get');
    expect(operations.athlete.operationId).toBe(
      'athlete_reports_v1_athletes__athlete_id__health_reports_get',
    );
  });

  it('ambas aceptan los mismos filtros, paginación por cursor y Authorization', () => {
    const names = (operation: OpenApiOperation) =>
      (operation.parameters ?? []).map((item) => `${item.in}:${item.name.toLowerCase()}`);
    const filters = [
      'query:from',
      'query:to',
      'query:type',
      'query:severity',
      'query:limit',
      'query:cursor',
    ];

    expect(names(operations.own)).toEqual([...filters, 'header:authorization']);
    expect(names(operations.athlete)).toEqual([
      'path:athlete_id',
      ...filters,
      'header:authorization',
    ]);
    expect(parameter(operations.athlete, 'athlete_id').schema['format']).toBe('uuid');
    for (const operation of [operations.own, operations.athlete]) {
      for (const name of ['from', 'to']) {
        const date = (parameter(operation, name).schema['anyOf'] as { format?: string }[])[0];
        expect(date.format).toBe('date');
      }
    }
  });

  it('los catálogos y el límite coinciden con el contrato', () => {
    const limit = parameter(operations.own, 'limit').schema;

    expect<Record<string, unknown>>(HEALTH_REPORTS_LIMIT).toEqual({
      min: limit['minimum'],
      max: limit['maximum'],
      default: limit['default'],
    });
    expect<string[]>([...HEALTH_REPORT_TYPES]).toEqual(enumOf('HealthReportType'));
    expect<string[]>([...HEALTH_SEVERITIES]).toEqual(enumOf('HealthSeverity'));
    expect<string[]>([...HEALTH_BODY_AREAS]).toEqual(enumOf('HealthBodyArea'));
    expect<string[]>([...HEALTH_REPORT_STATUSES]).toEqual(enumOf('HealthReportStatus'));
  });

  it('los modelos tienen exactamente las propiedades del contrato (solo los campos de ADR-037)', () => {
    const response: HealthReportHistoryResponseDto = HEALTH_REPORTS_RESPONSES.firstPage.body;
    const item: HealthReportHistoryItemDto = response.items[0];
    const itemSchema = schemas['HealthReportHistoryItem'];

    expect(Object.keys(response).sort()).toEqual(
      [...(schemas['HealthReportHistoryResponse']['required'] as string[])].sort(),
    );
    expect(Object.keys(item).sort()).toEqual([...(itemSchema['required'] as string[])].sort());
    expect(Object.keys(itemSchema['properties'] as object).sort()).toEqual(
      [
        'body_area',
        'expected_recovery_days',
        'occurred_at',
        'report_id',
        'session_id',
        'severity',
        'status',
        'type',
      ].sort(),
    );
  });

  it('los códigos de error del cliente son los que declara el contrato', () => {
    for (const operation of [operations.own, operations.athlete]) {
      expect<string[]>(Object.values(HEALTH_REPORTS_ERROR_CODES).sort()).toEqual(
        declaredCodes(operation, [401, 403, 422, 503, 504]),
      );
    }
  });

  for (const [name, response] of Object.entries(HEALTH_REPORTS_RESPONSES)) {
    it(`la respuesta simulada "${name}" (${response.status}) cumple el contrato`, () => {
      for (const operation of [operations.own, operations.athlete]) {
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
      }
    });
  }
});

describe('BffWebHealthReportsApi', () => {
  let api: BffWebHealthReportsApi;
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
    api = TestBed.inject(BffWebHealthReportsApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('consulta los reportes propios solo con los filtros presentes', () => {
    api
      .getOwnReports('token-sintetico', {
        from: '2026-10-01',
        to: null,
        type: 'INJURY',
        severity: undefined,
        limit: 20,
        cursor: undefined,
      })
      .subscribe();

    const request = http.expectOne((r) => r.url === 'http://bff.test/v1/me/health-reports');
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-sintetico');
    expect(request.request.params.keys().sort()).toEqual(['from', 'limit', 'type']);
    expect(request.request.params.get('type')).toBe('INJURY');
    request.flush(HEALTH_REPORTS_RESPONSES.empty.body);
  });

  it('consulta los reportes de un deportista con el cursor opaco sin modificarlo', () => {
    api
      .getAthleteReports('token-sintetico', SIMULATED_HEALTH_ATHLETE_ID, {
        severity: 'HIGH',
        cursor: 'abc+/=',
      })
      .subscribe();

    const request = http.expectOne(
      (r) => r.url === `http://bff.test/v1/athletes/${SIMULATED_HEALTH_ATHLETE_ID}/health-reports`,
    );
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-sintetico');
    expect(request.request.params.get('severity')).toBe('HIGH');
    expect(request.request.params.get('cursor')).toBe('abc+/=');
    expect(request.request.urlWithParams).toContain('cursor=abc%2B%2F%3D');
    request.flush(HEALTH_REPORTS_RESPONSES.lastPage.body);
  });
});
