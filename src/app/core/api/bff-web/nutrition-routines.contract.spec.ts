import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import {
  MY_ROUTINES_PATH,
  MY_ROUTINES_RESPONSES,
  PUBLISH_ROUTINE_RESPONSES,
  RETIRE_ROUTINE_PATH,
  RETIRE_ROUTINE_RESPONSES,
  ROUTINES_NEXT_CURSOR,
  ROUTINES_PATH,
  VALID_PUBLISH_ROUTINE_REQUEST,
  professionalRoutine,
} from '../../../../testing/bff-web/nutrition-routines.fixtures';
import { SIMULATED_FOOD_CATALOG } from '../../../../testing/bff-web/nutrition.fixtures';
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
  BffWebNutritionRoutinesApi,
  MY_ROUTINES_ERROR_CODES,
  PUBLISH_ROUTINE_ERROR_CODES,
  PUBLISH_ROUTINE_ISSUES,
  PublishRoutineRequestDto,
  RETIRE_ROUTINE_ERROR_CODES,
  ROUTINE_ALLERGENS,
  ROUTINE_DIET_PATTERNS,
  ROUTINE_GOALS,
  ROUTINE_IDEMPOTENT_REPLAYED_HEADER,
  ROUTINE_LIMITS,
  ROUTINE_MEAL_TYPES,
  ROUTINE_SPORTS,
  ROUTINE_STATUSES,
  RoutineResponseDto,
  RoutinesResponseDto,
} from './nutrition-routines.api';

type Schema = Record<string, unknown> & {
  properties: Record<string, Record<string, unknown>>;
  required: string[];
};

const contract = contractJson as unknown as OpenApiDocument;
const schemas = contract.components.schemas as Record<string, Schema>;
const operations = {
  publish: contract.paths[ROUTINES_PATH]['post'],
  retire: contract.paths[RETIRE_ROUTINE_PATH]['post'],
  list: contract.paths[MY_ROUTINES_PATH]['get'],
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

describe('Contrato bff-web: rutinas de alimentación del profesional (HU030, ADR-041)', () => {
  it('usa la versión del contrato y los operationId', () => {
    expect(contract.info.version).toBe(BFF_WEB_CONTRACT_VERSION);
    expect(operations.publish.operationId).toBe(
      'publish_routine_v1_nutrition_routine_templates_post',
    );
    expect(operations.retire.operationId).toBe(
      'retire_routine_v1_nutrition_routine_templates__template_id__retire_post',
    );
    expect(operations.list.operationId).toBe('my_routines_v1_me_nutrition_routine_templates_get');
  });

  it('publicar exige Idempotency-Key y expone Idempotent-Replayed; retirar y listar solo el token', () => {
    expect(headers(operations.publish)).toEqual([
      ['idempotency-key', 'true'],
      ['authorization', 'false'],
    ]);
    expect(Object.keys(operations.publish.responses['201'].headers ?? {})).toContain(
      ROUTINE_IDEMPOTENT_REPLAYED_HEADER,
    );
    expect(headers(operations.retire)).toEqual([['authorization', 'false']]);
    expect(headers(operations.list)).toEqual([['authorization', 'false']]);
    expect(
      (operations.list.parameters ?? []).filter((p) => p.in === 'query').map((p) => p.name),
    ).toEqual(['limit', 'cursor']);
  });

  it('la solicitud del cliente cumple el esquema y rechaza professional_id', () => {
    const schema = operations.publish.requestBody!.content['application/json'].schema;
    const body: PublishRoutineRequestDto = VALID_PUBLISH_ROUTINE_REQUEST;

    expect(validateAgainstSchema(contract, schema, body)).toEqual([]);
    expect(validateAgainstSchema(contract, schema, { ...body, sport: null })).toEqual([]);
    expect(validateAgainstSchema(contract, schema, { ...body, contains_allergens: [] })).toEqual(
      [],
    );
    expect(validateAgainstSchema(contract, schema, { ...body, professional_id: 'x' })).toEqual([
      '$.professional_id: propiedad no permitida',
    ]);
    expect(Object.keys(body).sort()).toEqual(
      Object.keys(schemas['PublishRoutineRequest'].properties).sort(),
    );
    expect(Object.keys(body.daily_meals[0]).sort()).toEqual(
      requiredProperties('RoutineMealRequest'),
    );
    expect(Object.keys(body.daily_meals[0].items[0]).sort()).toEqual(
      requiredProperties('RoutineItemRequest'),
    );
    expect(requiredProperties('RetireRoutineRequest')).toEqual(['expected_version']);
  });

  it('los alimentos de la solicitud simulada existen en el catálogo simulado de HU014', () => {
    const codes = SIMULATED_FOOD_CATALOG.items.map((item) => item.food_code as string);
    for (const meal of VALID_PUBLISH_ROUTINE_REQUEST.daily_meals) {
      for (const item of meal.items) {
        expect(codes).toContain(item.food_code);
      }
    }
  });

  it('las respuestas del cliente tienen exactamente las propiedades obligatorias del contrato', () => {
    const routine: RoutineResponseDto = professionalRoutine(0);
    const page: RoutinesResponseDto = MY_ROUTINES_RESPONSES.firstPage.body;

    expect(Object.keys(routine).sort()).toEqual(requiredProperties('RoutineResponse'));
    expect(Object.keys(page).sort()).toEqual(requiredProperties('RoutinesResponse'));
    expect(Object.keys(routine.daily_meals[0]).sort()).toEqual(
      requiredProperties('RoutineMealResponse'),
    );
    expect(Object.keys(routine.daily_meals[0].items[0]).sort()).toEqual(
      requiredProperties('RoutineItemResponse'),
    );
  });

  it('los catálogos cerrados y los límites coinciden con el contrato', () => {
    const body = schemas['PublishRoutineRequest'].properties;
    const meal = schemas['RoutineMealRequest'].properties;
    const item = schemas['RoutineItemRequest'].properties;

    expect<readonly string[]>(ROUTINE_SPORTS).toEqual(schemas['Sport']['enum'] as string[]);
    expect<readonly string[]>(ROUTINE_GOALS).toEqual(schemas['Goal']['enum'] as string[]);
    expect<readonly string[]>(ROUTINE_DIET_PATTERNS).toEqual(
      schemas['DietPattern']['enum'] as string[],
    );
    expect<readonly string[]>(ROUTINE_ALLERGENS).toEqual(schemas['Allergy']['enum'] as string[]);
    expect<readonly string[]>(ROUTINE_MEAL_TYPES).toEqual(schemas['MealType']['enum'] as string[]);
    expect<readonly string[]>(ROUTINE_STATUSES).toEqual(
      schemas['RoutineResponse'].properties['status']['enum'] as string[],
    );
    expect<number>(ROUTINE_LIMITS.titleMin).toBe(body['title']['minLength'] as number);
    expect<number>(ROUTINE_LIMITS.titleMax).toBe(body['title']['maxLength'] as number);
    expect<number>(ROUTINE_LIMITS.descriptionMin).toBe(body['description']['minLength'] as number);
    expect<number>(ROUTINE_LIMITS.descriptionMax).toBe(body['description']['maxLength'] as number);
    expect<number>(ROUTINE_LIMITS.daysMin).toBe(body['duration_days']['minimum'] as number);
    expect<number>(ROUTINE_LIMITS.daysMax).toBe(body['duration_days']['maximum'] as number);
    expect<number>(ROUTINE_LIMITS.allergensMax).toBe(
      body['contains_allergens']['maxItems'] as number,
    );
    expect<number>(ROUTINE_LIMITS.mealsMin).toBe(body['daily_meals']['minItems'] as number);
    expect<number>(ROUTINE_LIMITS.mealsMax).toBe(body['daily_meals']['maxItems'] as number);
    expect<number>(ROUTINE_LIMITS.itemsMin).toBe(meal['items']['minItems'] as number);
    expect<number>(ROUTINE_LIMITS.itemsMax).toBe(meal['items']['maxItems'] as number);
    expect<number>(ROUTINE_LIMITS.foodCodeMax).toBe(item['food_code']['maxLength'] as number);
    expect<number>(ROUTINE_LIMITS.portionsMin).toBe(item['portions']['minimum'] as number);
    expect<number>(ROUTINE_LIMITS.portionsMax).toBe(item['portions']['maximum'] as number);
    const limit = (operations.list.parameters ?? []).find((p) => p.name === 'limit')!;
    expect(limit.schema['description']).toContain(
      `de ${ROUTINE_LIMITS.listMin} a ${ROUTINE_LIMITS.listMax}; ${ROUTINE_LIMITS.listDefault} por defecto`,
    );
  });

  it('los códigos de error y los motivos del 422 son los que declaran las operaciones', () => {
    expect<string[]>(Object.values(PUBLISH_ROUTINE_ERROR_CODES).sort()).toEqual(
      declaredCodes(operations.publish, [401, 403, 409, 422, 503, 504]),
    );
    expect<string[]>(Object.values(RETIRE_ROUTINE_ERROR_CODES).sort()).toEqual(
      declaredCodes(operations.retire, [401, 403, 404, 409, 422, 503, 504]),
    );
    expect<string[]>(Object.values(MY_ROUTINES_ERROR_CODES).sort()).toEqual(
      declaredCodes(operations.list, [401, 403, 422, 503, 504]),
    );
    const publish422 = operations.publish.responses['422'].description ?? '';
    for (const issue of PUBLISH_ROUTINE_ISSUES) {
      expect(publish422).withContext(issue).toContain(`\`${issue}\``);
    }
    expect(operations.retire.responses['409'].description).toContain(
      '`{field: expected_version, issue: <versión vigente>}`',
    );
  });

  it('las respuestas simuladas cumplen el contrato', () => {
    expectValid(operations.publish, PUBLISH_ROUTINE_RESPONSES);
    expectValid(operations.retire, RETIRE_ROUTINE_RESPONSES);
    expectValid(operations.list, MY_ROUTINES_RESPONSES);
  });
});

describe('BffWebNutritionRoutinesApi', () => {
  let api: BffWebNutritionRoutinesApi;
  let http: HttpTestingController;
  const routine = professionalRoutine(0);

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
    api = TestBed.inject(BffWebNutritionRoutinesApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('publica con token, Idempotency-Key y la respuesta completa', () => {
    let replayed: string | null = null;
    api
      .publishRoutine('token-sintetico', VALID_PUBLISH_ROUTINE_REQUEST, 'clave-uuid')
      .subscribe((response) => (replayed = response.headers.get('Idempotent-Replayed')));

    const request = http.expectOne('http://bff.test/v1/nutrition-routine-templates');
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-sintetico');
    expect(request.request.headers.get('Idempotency-Key')).toBe('clave-uuid');
    expect(request.request.body).toEqual(VALID_PUBLISH_ROUTINE_REQUEST);
    request.flush(routine, {
      status: 201,
      statusText: 'Created',
      headers: { 'Idempotent-Replayed': 'true' },
    });
    expect(replayed!).toBe('true');
  });

  it('retira con la versión esperada', () => {
    api.retireRoutine('token-sintetico', routine.template_id, { expected_version: 1 }).subscribe();

    const request = http.expectOne(
      `http://bff.test/v1/nutrition-routine-templates/${routine.template_id}/retire`,
    );
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-sintetico');
    expect(request.request.body).toEqual({ expected_version: 1 });
    request.flush(RETIRE_ROUTINE_RESPONSES.retired.body);
  });

  it('lista con el tamaño y el cursor sin modificar', () => {
    const cursor = `${ROUTINES_NEXT_CURSOR}+/=`;
    api.getMyRoutines('token-sintetico', { limit: 20, cursor }).subscribe();

    const request = http.expectOne(
      (r) => r.url === 'http://bff.test/v1/me/nutrition-routine-templates',
    );
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-sintetico');
    expect(request.request.params.get('limit')).toBe('20');
    expect(request.request.params.get('cursor')).toBe(cursor);
    request.flush(MY_ROUTINES_RESPONSES.lastPage.body);
  });

  it('no envía los parámetros ausentes', () => {
    api.getMyRoutines('token-sintetico', { limit: null, cursor: null }).subscribe();

    const request = http.expectOne(
      (r) => r.url === 'http://bff.test/v1/me/nutrition-routine-templates',
    );
    expect(request.request.params.keys()).toEqual([]);
    request.flush(MY_ROUTINES_RESPONSES.empty.body);
  });
});
