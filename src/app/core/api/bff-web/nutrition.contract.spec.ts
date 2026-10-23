import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import {
  CREATE_NUTRITION_PLAN_RESPONSES,
  FOOD_CATALOG_PATH,
  FOOD_CATALOG_RESPONSES,
  GET_NUTRITION_PLAN_RESPONSES,
  MY_NUTRITION_PLANS_PATH,
  MY_NUTRITION_PLANS_RESPONSES,
  NUTRITION_PLANS_PATH,
  SIMULATED_FOOD_CATALOG_ETAG,
  SIMULATED_NEXT_CURSOR,
  SIMULATED_NUTRITION_PLAN_ID,
  VALID_CREATE_NUTRITION_PLAN_REQUEST,
} from '../../../../testing/bff-web/nutrition.fixtures';
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
  BffWebNutritionApi,
  CREATE_NUTRITION_PLAN_ERROR_CODES,
  CreateNutritionPlanRequestDto,
  CreatedNutritionPlanResponseDto,
  ETAG_HEADER,
  FOOD_CATALOG_ERROR_CODES,
  FOOD_CATEGORIES,
  FOOD_UNITS,
  FoodCatalogItemDto,
  FoodCatalogResponseDto,
  GET_NUTRITION_PLAN_ERROR_CODES,
  IDEMPOTENT_REPLAYED_HEADER,
  MEAL_TYPES,
  MY_NUTRITION_PLANS_ERROR_CODES,
  NUTRITION_HABITS_MISSING,
  NUTRITION_PLAN_ISSUES,
  NUTRITION_PLAN_LIMITS,
  NutritionPlanResponseDto,
  NutritionPlansPageDto,
  QUANTITY_PATTERN,
} from './nutrition.api';

const contract = contractJson as unknown as OpenApiDocument;
const schemas = contract.components.schemas as Record<string, Record<string, unknown>>;
const PLAN_PATH = `${NUTRITION_PLANS_PATH}/{plan_id}`;

const operations = {
  catalog: contract.paths[FOOD_CATALOG_PATH]['get'],
  create: contract.paths[NUTRITION_PLANS_PATH]['post'],
  get: contract.paths[PLAN_PATH]['get'],
  mine: contract.paths[MY_NUTRITION_PLANS_PATH]['get'],
} satisfies Record<string, OpenApiOperation>;

/** Valores entre comillas invertidas de la descripción de cada respuesta. */
function quoted(operation: OpenApiOperation, status: number): string[] {
  const description = operation.responses[String(status)]?.description ?? '';
  return [...description.matchAll(/`([a-z_]+)`/g)].map((match) => match[1]);
}

/**
 * Códigos de error declarados. El `422` de crear un plan cita `details` y, tras
 * «Motivos estables», los valores de `details[].issue`; el de `GET
 * /v1/me/nutrition-plans` cita entre paréntesis los motivos de cada parámetro.
 * Ninguno de ellos es un código.
 */
function declaredCodes(operation: OpenApiOperation, statuses: number[]): string[] {
  return statuses
    .flatMap((status) => {
      const description = operation.responses[String(status)]?.description ?? '';
      const codes = description.split('Motivos estables')[0].replace(/\([^)]*\)/g, '');
      return [...codes.matchAll(/`([a-z_]+)`/g)].map((match) => match[1]);
    })
    .filter((code) => code !== 'details')
    .sort();
}

function requiredProperties(schema: string): string[] {
  return [...(schemas[schema]['required'] as string[])].sort();
}

function property(schema: string, name: string): Record<string, unknown> {
  return (schemas[schema]['properties'] as Record<string, Record<string, unknown>>)[name];
}

function headerNames(operation: OpenApiOperation): string[][] {
  return (operation.parameters ?? [])
    .filter((parameter) => parameter.in === 'header')
    .map((parameter) => [parameter.name.toLowerCase(), String(parameter.required ?? false)]);
}

describe('Contrato bff-web: operaciones de HU014', () => {
  it('usa la versión del contrato y sus operationId', () => {
    expect(contract.info.version).toBe(BFF_WEB_CONTRACT_VERSION);
    expect(operations.catalog.operationId).toBe('food_catalog_v1_food_catalog_get');
    expect(operations.create.operationId).toBe('create_plan_v1_nutrition_plans_post');
    expect(operations.get.operationId).toBe('get_plan_v1_nutrition_plans__plan_id__get');
    expect(operations.mine.operationId).toBe('my_plans_v1_me_nutrition_plans_get');
  });

  it('todas se autentican con Authorization; crear exige Idempotency-Key y el catálogo admite If-None-Match', () => {
    for (const operation of [operations.get, operations.mine]) {
      expect(headerNames(operation)).toEqual([['authorization', 'false']]);
    }
    expect(headerNames(operations.catalog)).toEqual([
      ['if-none-match', 'false'],
      ['authorization', 'false'],
    ]);
    expect(headerNames(operations.create)).toEqual([
      ['idempotency-key', 'true'],
      ['authorization', 'false'],
    ]);
    const key = operations.create.parameters!.find((p) => p.name === 'Idempotency-Key');
    expect(key?.schema['format']).toBe('uuid');
    expect(Object.keys(operations.create.responses['201'].headers ?? {})).toContain(
      IDEMPOTENT_REPLAYED_HEADER,
    );
    expect(Object.keys(operations.catalog.responses['200'].headers ?? {})).toEqual([ETAG_HEADER]);
    expect(operations.catalog.responses['304'].content).toBeUndefined();
  });

  it('la consulta propia solo admite limit y cursor', () => {
    const query = (operations.mine.parameters ?? [])
      .filter((parameter) => parameter.in === 'query')
      .map((parameter) => parameter.name);
    expect(query).toEqual(['limit', 'cursor']);
  });

  it('la solicitud del cliente tiene exactamente las propiedades del contrato', () => {
    const create: CreateNutritionPlanRequestDto = VALID_CREATE_NUTRITION_PLAN_REQUEST;

    expect(Object.keys(create).sort()).toEqual(requiredProperties('CreateNutritionPlanRequest'));
    expect(Object.keys(create.meals[0]).sort()).toEqual(requiredProperties('NutritionPlanMeal'));
    expect(Object.keys(create.meals[0].items[0]).sort()).toEqual(
      requiredProperties('NutritionPlanItem'),
    );
    expect(
      validateAgainstSchema(
        contract,
        operations.create.requestBody!.content['application/json'].schema,
        create,
      ),
    ).toEqual([]);
  });

  it('las respuestas del cliente tienen exactamente las propiedades obligatorias del contrato', () => {
    const catalog: FoodCatalogResponseDto = FOOD_CATALOG_RESPONSES.ok.body;
    const item: FoodCatalogItemDto = catalog.items[0];
    const created: CreatedNutritionPlanResponseDto = CREATE_NUTRITION_PLAN_RESPONSES.created.body;
    const plan: NutritionPlanResponseDto = GET_NUTRITION_PLAN_RESPONSES.found.body;
    const page: NutritionPlansPageDto = MY_NUTRITION_PLANS_RESPONSES.firstPage.body;

    expect(Object.keys(catalog).sort()).toEqual(requiredProperties('FoodCatalogResponse'));
    expect(Object.keys(item).sort()).toEqual(requiredProperties('FoodCatalogItem'));
    expect(Object.keys(created).sort()).toEqual(requiredProperties('CreatedNutritionPlanResponse'));
    expect(Object.keys(plan).sort()).toEqual(requiredProperties('NutritionPlanResponse'));
    expect(Object.keys(page).sort()).toEqual(requiredProperties('NutritionPlansPage'));
  });

  it('las enumeraciones, el aviso y los límites coinciden con el contrato', () => {
    const request = (name: string) => property('CreateNutritionPlanRequest', name);
    const meal = (name: string) => property('NutritionPlanMeal', name);
    const objectives = request('objectives')['items'] as Record<string, unknown>;
    const warnings = property('CreatedNutritionPlanResponse', 'warnings')['items'] as Record<
      string,
      unknown
    >;

    expect<string[]>([...FOOD_UNITS]).toEqual(schemas['FoodUnit']['enum'] as string[]);
    expect<string[]>([...FOOD_CATEGORIES]).toEqual(schemas['FoodCategory']['enum'] as string[]);
    expect<string[]>([...MEAL_TYPES]).toEqual(schemas['MealType']['enum'] as string[]);
    expect(warnings['const']).toBe(NUTRITION_HABITS_MISSING);
    expect(property('NutritionPlanItem', 'quantity')['pattern']).toBe(QUANTITY_PATTERN);
    expect<Record<string, unknown>>(NUTRITION_PLAN_LIMITS).toEqual({
      emailMax: request('athlete_email')['maxLength'],
      titleMax: request('title')['maxLength'],
      objectivesMin: request('objectives')['minItems'],
      objectivesMax: request('objectives')['maxItems'],
      objectiveMax: objectives['maxLength'],
      mealsMin: request('meals')['minItems'],
      mealsMax: request('meals')['maxItems'],
      itemsMin: meal('items')['minItems'],
      itemsMax: meal('items')['maxItems'],
      quantityMax: property('NutritionPlanItem', 'quantity')['maxLength'],
    });
  });

  it('los motivos de nutrition_plan_invalid son los que enumera el contrato', () => {
    const description = operations.create.responses['422'].description;
    const listed = description.split('Motivos estables de `issue`:')[1];
    const issues = [...listed.matchAll(/`([a-z_]+)`/g)].map((match) => match[1]);

    expect<string[]>([...NUTRITION_PLAN_ISSUES]).toEqual(issues);
  });

  it('los códigos de error del cliente son los que declara el contrato', () => {
    expect<string[]>(Object.values(FOOD_CATALOG_ERROR_CODES).sort()).toEqual(
      declaredCodes(operations.catalog, [401, 503, 504]),
    );
    expect<string[]>(Object.values(CREATE_NUTRITION_PLAN_ERROR_CODES).sort()).toEqual(
      declaredCodes(operations.create, [401, 403, 409, 422, 503, 504]),
    );
    expect<string[]>(Object.values(GET_NUTRITION_PLAN_ERROR_CODES).sort()).toEqual(
      declaredCodes(operations.get, [401, 403, 404, 503, 504]),
    );
    expect<string[]>(Object.values(MY_NUTRITION_PLANS_ERROR_CODES).sort()).toEqual(
      declaredCodes(operations.mine, [401, 403, 422, 503, 504]),
    );
    // Los motivos de los parámetros de la consulta propia sí se citan en el 422.
    expect(quoted(operations.mine, 422)).toEqual([
      'validation_error',
      'out_of_range',
      'invalid_cursor',
    ]);
  });

  const simulated: [string, OpenApiOperation, Record<string, { status: number; body: unknown }>][] =
    [
      ['GET /v1/food-catalog', operations.catalog, FOOD_CATALOG_RESPONSES],
      ['POST /v1/nutrition-plans', operations.create, CREATE_NUTRITION_PLAN_RESPONSES],
      ['GET /v1/nutrition-plans/{plan_id}', operations.get, GET_NUTRITION_PLAN_RESPONSES],
      ['GET /v1/me/nutrition-plans', operations.mine, MY_NUTRITION_PLANS_RESPONSES],
    ];
  for (const [name, operation, responses] of simulated) {
    for (const [key, response] of Object.entries(responses)) {
      it(`${name}: la respuesta simulada "${key}" (${response.status}) cumple el contrato`, () => {
        if (response.status === 304) {
          expect(operation.responses['304'].content).toBeUndefined();
          expect(response.body).toBeNull();
          return;
        }
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

describe('BffWebNutritionApi', () => {
  let api: BffWebNutritionApi;
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
    api = TestBed.inject(BffWebNutritionApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('consulta el catálogo sin If-None-Match la primera vez y lee el ETag', () => {
    let etag = null as string | null;
    api.getFoodCatalog('token-sintetico', null).subscribe((r) => (etag = r.headers.get('ETag')));

    const request = http.expectOne('http://bff.test/v1/food-catalog');
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-sintetico');
    expect(request.request.headers.has('If-None-Match')).toBeFalse();
    request.flush(FOOD_CATALOG_RESPONSES.ok.body, {
      headers: { ETag: SIMULATED_FOOD_CATALOG_ETAG },
    });
    expect(etag).toBe(SIMULATED_FOOD_CATALOG_ETAG);
  });

  it('revalida el catálogo con If-None-Match', () => {
    let status = 0;
    api
      .getFoodCatalog('token-sintetico', SIMULATED_FOOD_CATALOG_ETAG)
      .subscribe({ error: (error: { status: number }) => (status = error.status) });

    const request = http.expectOne('http://bff.test/v1/food-catalog');
    expect(request.request.headers.get('If-None-Match')).toBe(SIMULATED_FOOD_CATALOG_ETAG);
    request.flush(null, { status: 304, statusText: 'Not Modified' });
    // `HttpClient` entrega el 304 como error; el adaptador lo trata como «sin cambios».
    expect(status).toBe(304);
  });

  it('crea el plan con Idempotency-Key y expone Idempotent-Replayed', () => {
    let replayed: string | null | undefined;
    api
      .createPlan('token-sintetico', VALID_CREATE_NUTRITION_PLAN_REQUEST, 'clave-uuid')
      .subscribe((response) => (replayed = response.headers.get(IDEMPOTENT_REPLAYED_HEADER)));

    const request = http.expectOne('http://bff.test/v1/nutrition-plans');
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-sintetico');
    expect(request.request.headers.get('Idempotency-Key')).toBe('clave-uuid');
    expect(request.request.body).toEqual(VALID_CREATE_NUTRITION_PLAN_REQUEST);
    request.flush(CREATE_NUTRITION_PLAN_RESPONSES.created.body, {
      status: 201,
      statusText: 'Created',
      headers: { [IDEMPOTENT_REPLAYED_HEADER]: 'true' },
    });
    expect(replayed).toBe('true');
  });

  it('consulta el plan por identificador', () => {
    api.getPlan('token-sintetico', SIMULATED_NUTRITION_PLAN_ID).subscribe();

    const request = http.expectOne(
      `http://bff.test/v1/nutrition-plans/${SIMULATED_NUTRITION_PLAN_ID}`,
    );
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-sintetico');
    request.flush(GET_NUTRITION_PLAN_RESPONSES.found.body);
  });

  it('consulta los planes propios sin parámetros y luego con el cursor sin modificar', () => {
    api.getMyPlans('token-sintetico', null).subscribe();
    const first = http.expectOne('http://bff.test/v1/me/nutrition-plans');
    expect(first.request.params.keys()).toEqual([]);
    first.flush(MY_NUTRITION_PLANS_RESPONSES.firstPage.body);

    api.getMyPlans('token-sintetico', SIMULATED_NEXT_CURSOR).subscribe();
    const next = http.expectOne((r) => r.url === 'http://bff.test/v1/me/nutrition-plans');
    expect(next.request.headers.get('Authorization')).toBe('Bearer token-sintetico');
    expect(next.request.urlWithParams).toBe(
      `http://bff.test/v1/me/nutrition-plans?cursor=${encodeURIComponent(SIMULATED_NEXT_CURSOR)}`,
    );
    next.flush(MY_NUTRITION_PLANS_RESPONSES.lastPage.body);
  });
});
