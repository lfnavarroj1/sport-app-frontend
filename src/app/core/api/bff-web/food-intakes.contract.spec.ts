import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import {
  FOOD_INTAKES_RESPONSES,
  MY_FOOD_INTAKES_PATH,
  SIMULATED_INTAKES_ATHLETE_ID,
} from '../../../../testing/bff-web/food-intakes.fixtures';
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
  BffWebFoodIntakesApi,
  FOOD_INTAKES_ERROR_CODES,
  FOOD_INTAKES_ISSUES,
  FOOD_INTAKES_LIMIT,
  FoodIntakeItemDto,
  FoodIntakeResponseDto,
  FoodIntakesPageDto,
} from './food-intakes.api';
import { FOOD_UNITS, MEAL_TYPES } from './nutrition.api';

const contract = contractJson as unknown as OpenApiDocument;
const schemas = contract.components.schemas as Record<string, Record<string, unknown>>;
const operations = {
  own: contract.paths[MY_FOOD_INTAKES_PATH]['get'],
  athlete: contract.paths['/v1/athletes/{athlete_id}/food-intakes']['get'],
} satisfies Record<string, OpenApiOperation>;

function declaredCodes(operation: OpenApiOperation, statuses: number[]): string[] {
  return [
    ...new Set(
      statuses.flatMap((status) => {
        const description = operation.responses[String(status)]?.description ?? '';
        return [...description.matchAll(/`([a-z_]+)`/g)].map((match) => match[1]);
      }),
    ),
  ].sort();
}

function parameter(operation: OpenApiOperation, name: string) {
  return operation.parameters!.find((item) => item.name === name)!;
}

function required(schema: string): string[] {
  return [...(schemas[schema]['required'] as string[])].sort();
}

describe('Contrato bff-web: consultas de HU013', () => {
  it('usa la versión del contrato y sus operationId', () => {
    expect(contract.info.version).toBe(BFF_WEB_CONTRACT_VERSION);
    expect(operations.own.operationId).toBe('my_food_intakes_v1_me_food_intakes_get');
    expect(operations.athlete.operationId).toBe(
      'athlete_food_intakes_v1_athletes__athlete_id__food_intakes_get',
    );
  });

  it('ambas aceptan los mismos filtros, paginación por cursor y Authorization', () => {
    const names = (operation: OpenApiOperation) =>
      (operation.parameters ?? []).map((item) => `${item.in}:${item.name.toLowerCase()}`);
    const filters = ['query:from', 'query:to', 'query:meal_type', 'query:limit', 'query:cursor'];

    expect(names(operations.own)).toEqual([...filters, 'header:authorization']);
    expect(names(operations.athlete)).toEqual([
      'path:athlete_id',
      ...filters,
      'header:authorization',
    ]);
    expect(parameter(operations.athlete, 'athlete_id').schema['format']).toBe('uuid');
    for (const name of ['from', 'to']) {
      const date = (parameter(operations.own, name).schema['anyOf'] as { format?: string }[])[0];
      expect(date.format).toBe('date');
    }
  });

  it('el límite, los tipos de comida y las unidades coinciden con el contrato', () => {
    const limit = parameter(operations.own, 'limit').schema;
    const item = schemas['FoodIntakeItem']['properties'] as Record<string, { $ref?: string }>;

    expect<Record<string, unknown>>(FOOD_INTAKES_LIMIT).toEqual({
      min: limit['minimum'],
      max: limit['maximum'],
      default: limit['default'],
    });
    expect<string[]>([...MEAL_TYPES]).toEqual(schemas['MealType']['enum'] as string[]);
    expect(item['unit'].$ref).toBe('#/components/schemas/FoodUnit');
    expect<string[]>([...FOOD_UNITS]).toEqual(schemas['FoodUnit']['enum'] as string[]);
  });

  it('los modelos tienen exactamente las propiedades obligatorias del contrato', () => {
    const page: FoodIntakesPageDto = FOOD_INTAKES_RESPONSES.firstPage.body;
    const intake: FoodIntakeResponseDto = page.items[0];
    const item: FoodIntakeItemDto = intake.items[0];

    expect(Object.keys(page).sort()).toEqual(required('FoodIntakesPage'));
    expect(Object.keys(intake).sort()).toEqual(required('FoodIntakeResponse'));
    expect(Object.keys(item).sort()).toEqual(required('FoodIntakeItem'));
  });

  it('los códigos de error del cliente son los que declara el contrato', () => {
    for (const operation of [operations.own, operations.athlete]) {
      expect<string[]>(Object.values(FOOD_INTAKES_ERROR_CODES).sort()).toEqual(
        declaredCodes(operation, [401, 403, 422, 503, 504]).filter(
          (code) => !Object.values(FOOD_INTAKES_ISSUES).some((issue) => issue.issue === code),
        ),
      );
    }
  });

  it('los motivos de 422 del cliente son los que documenta el contrato (CA2)', () => {
    for (const operation of [operations.own, operations.athlete]) {
      const description = operation.responses['422'].description;
      for (const { field, issue } of Object.values(FOOD_INTAKES_ISSUES)) {
        expect(description).toContain(`\`${field}\` \`${issue}\``);
      }
    }
  });

  for (const [name, response] of Object.entries(FOOD_INTAKES_RESPONSES)) {
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

describe('BffWebFoodIntakesApi', () => {
  let api: BffWebFoodIntakesApi;
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
    api = TestBed.inject(BffWebFoodIntakesApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('consulta los consumos propios solo con los filtros presentes', () => {
    api
      .getOwnIntakes('token-sintetico', {
        from: '2026-10-01',
        to: null,
        meal_type: 'LUNCH',
        limit: 20,
        cursor: undefined,
      })
      .subscribe();

    const request = http.expectOne((r) => r.url === 'http://bff.test/v1/me/food-intakes');
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-sintetico');
    expect(request.request.params.keys().sort()).toEqual(['from', 'limit', 'meal_type']);
    expect(request.request.params.get('meal_type')).toBe('LUNCH');
    request.flush(FOOD_INTAKES_RESPONSES.empty.body);
  });

  it('consulta los consumos de un deportista con el cursor opaco sin modificarlo', () => {
    api
      .getAthleteIntakes('token-sintetico', SIMULATED_INTAKES_ATHLETE_ID, { cursor: 'abc+/=' })
      .subscribe();

    const request = http.expectOne(
      (r) => r.url === `http://bff.test/v1/athletes/${SIMULATED_INTAKES_ATHLETE_ID}/food-intakes`,
    );
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-sintetico');
    expect(request.request.params.get('cursor')).toBe('abc+/=');
    expect(request.request.urlWithParams).toContain('cursor=abc%2B%2F%3D');
    request.flush(FOOD_INTAKES_RESPONSES.lastPage.body);
  });
});
