import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import {
  OWN_TRAINING_HISTORY_PATH,
  SIMULATED_HISTORY_ATHLETE_ID,
  TRAINING_ATHLETES_PATH,
  TRAINING_ATHLETES_RESPONSES,
  TRAINING_HISTORY_RESPONSES,
} from '../../../../testing/bff-web/training-history.fixtures';
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
  BffWebTrainingHistoryApi,
  SessionHistoryItemDto,
  TRAINING_ATHLETES_ERROR_CODES,
  TRAINING_HISTORY_ERROR_CODES,
  TRAINING_HISTORY_LIMIT,
  TrainingAthleteItemDto,
  TrainingAthletesResponseDto,
  TrainingHistoryResponseDto,
} from './training-history.api';
import { SPORTS } from './training.api';

const contract = contractJson as unknown as OpenApiDocument;
const schemas = contract.components.schemas as Record<string, Record<string, unknown>>;
const operations = {
  own: contract.paths[OWN_TRAINING_HISTORY_PATH]['get'],
  athlete: contract.paths['/v1/athletes/{athlete_id}/training-history']['get'],
  athletes: contract.paths[TRAINING_ATHLETES_PATH]['get'],
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

describe('Contrato bff-web: consultas de HU011', () => {
  it('usa la versión del contrato y sus operationId', () => {
    expect(contract.info.version).toBe(BFF_WEB_CONTRACT_VERSION);
    expect(operations.own.operationId).toBe('own_history_v1_training_history_get');
    expect(operations.athlete.operationId).toBe(
      'athlete_history_v1_athletes__athlete_id__training_history_get',
    );
  });

  it('ambas aceptan los mismos filtros, paginación por cursor y Authorization', () => {
    const names = (operation: OpenApiOperation) =>
      (operation.parameters ?? []).map((item) => `${item.in}:${item.name.toLowerCase()}`);
    const filters = ['query:from', 'query:to', 'query:sport', 'query:limit', 'query:cursor'];

    expect(names(operations.own)).toEqual([...filters, 'header:authorization']);
    expect(names(operations.athlete)).toEqual([
      'path:athlete_id',
      ...filters,
      'header:authorization',
    ]);
    expect(parameter(operations.athlete, 'athlete_id').schema['format']).toBe('uuid');
  });

  it('el catálogo de deportes y el límite coinciden con el contrato', () => {
    const limit = parameter(operations.own, 'limit').schema;
    const sport = (parameter(operations.own, 'sport').schema['anyOf'] as { enum?: string[] }[])[0];

    expect<Record<string, unknown>>(TRAINING_HISTORY_LIMIT).toEqual({
      min: limit['minimum'],
      max: limit['maximum'],
      default: limit['default'],
    });
    expect<string[]>([...SPORTS]).toEqual(sport.enum!);
  });

  it('los modelos tienen exactamente las propiedades obligatorias del contrato', () => {
    const response: TrainingHistoryResponseDto = TRAINING_HISTORY_RESPONSES.firstPage.body;
    const item: SessionHistoryItemDto = response.items[0];

    expect(Object.keys(response).sort()).toEqual(
      [...(schemas['TrainingHistoryResponse']['required'] as string[])].sort(),
    );
    expect(Object.keys(item).sort()).toEqual(
      [...(schemas['SessionHistoryItem']['required'] as string[])].sort(),
    );
  });

  it('los códigos de error del cliente son los que declara el contrato', () => {
    for (const operation of [operations.own, operations.athlete]) {
      expect<string[]>(Object.values(TRAINING_HISTORY_ERROR_CODES).sort()).toEqual(
        declaredCodes(operation, [401, 403, 422, 503, 504]),
      );
    }
  });

  for (const [name, response] of Object.entries(TRAINING_HISTORY_RESPONSES)) {
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

describe('Contrato bff-web: deportistas autorizados de HU011 (CA5)', () => {
  it('usa su operationId y solo acepta paginación y Authorization', () => {
    expect(operations.athletes.operationId).toBe('training_athletes_v1_me_training_athletes_get');
    expect(
      (operations.athletes.parameters ?? []).map((item) => `${item.in}:${item.name.toLowerCase()}`),
    ).toEqual(['query:limit', 'query:cursor', 'header:authorization']);
  });

  it('el límite coincide con el de las consultas del historial', () => {
    const limit = parameter(operations.athletes, 'limit').schema;

    expect<Record<string, unknown>>(TRAINING_HISTORY_LIMIT).toEqual({
      min: limit['minimum'],
      max: limit['maximum'],
      default: limit['default'],
    });
  });

  it('los modelos tienen exactamente las propiedades obligatorias del contrato', () => {
    const response: TrainingAthletesResponseDto = TRAINING_ATHLETES_RESPONSES.firstPage.body;
    const item: TrainingAthleteItemDto = response.items[0];

    expect(Object.keys(response).sort()).toEqual(
      [...(schemas['TrainingAthletesResponse']['required'] as string[])].sort(),
    );
    expect(Object.keys(item).sort()).toEqual(
      [...(schemas['TrainingAthleteItem']['required'] as string[])].sort(),
    );
  });

  it('los códigos de error del cliente son los que declara el contrato', () => {
    expect<string[]>(Object.values(TRAINING_ATHLETES_ERROR_CODES).sort()).toEqual(
      declaredCodes(operations.athletes, [401, 403, 422, 503, 504]),
    );
  });

  for (const [name, response] of Object.entries(TRAINING_ATHLETES_RESPONSES)) {
    it(`la respuesta simulada "${name}" (${response.status}) cumple el contrato`, () => {
      expect(
        validateAgainstSchema(
          contract,
          responseSchema(operations.athletes, response.status),
          response.body,
        ),
      ).toEqual([]);
      if (response.status >= 400) {
        expect(declaredCodes(operations.athletes, [response.status])).toContain(
          (response.body as { code: string }).code,
        );
      }
    });
  }
});

describe('BffWebTrainingHistoryApi', () => {
  let api: BffWebTrainingHistoryApi;
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
    api = TestBed.inject(BffWebTrainingHistoryApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('consulta el historial propio solo con los filtros presentes', () => {
    api
      .getOwnHistory('token-sintetico', {
        from: '2026-10-01',
        to: null,
        sport: 'running',
        limit: 20,
        cursor: undefined,
      })
      .subscribe();

    const request = http.expectOne((r) => r.url === 'http://bff.test/v1/training-history');
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-sintetico');
    expect(request.request.params.keys().sort()).toEqual(['from', 'limit', 'sport']);
    expect(request.request.params.get('from')).toBe('2026-10-01');
    request.flush(TRAINING_HISTORY_RESPONSES.empty.body);
  });

  it('consulta el historial de un deportista con el cursor opaco sin modificarlo', () => {
    api
      .getAthleteHistory('token-sintetico', SIMULATED_HISTORY_ATHLETE_ID, {
        cursor: 'abc+/=',
      })
      .subscribe();

    const request = http.expectOne(
      (r) =>
        r.url === `http://bff.test/v1/athletes/${SIMULATED_HISTORY_ATHLETE_ID}/training-history`,
    );
    expect(request.request.params.get('cursor')).toBe('abc+/=');
    expect(request.request.urlWithParams).toContain('cursor=abc%2B%2F%3D');
    request.flush(TRAINING_HISTORY_RESPONSES.lastPage.body);
  });

  it('consulta los deportistas autorizados sin identificadores y con el cursor intacto', () => {
    api.getTrainingAthletes('token-sintetico', { limit: 20, cursor: 'abc+/=' }).subscribe();

    const request = http.expectOne((r) => r.url === 'http://bff.test/v1/me/training-athletes');
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-sintetico');
    expect(request.request.params.keys().sort()).toEqual(['cursor', 'limit']);
    expect(request.request.urlWithParams).toContain('cursor=abc%2B%2F%3D');
    request.flush(TRAINING_ATHLETES_RESPONSES.lastPage.body);
  });
});
