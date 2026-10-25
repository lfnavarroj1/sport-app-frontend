import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import {
  DEMOGRAPHIC_PROFILE_PATH,
  DEMOGRAPHIC_RESPONSE,
  DEMOGRAPHIC_RESPONSES,
  FULL_PROFILE,
  GET_PROFILE_RESPONSES,
  NUTRITION_HABITS_PATH,
  NUTRITION_HABITS_RESPONSE,
  NUTRITION_HABITS_RESPONSES,
  PHYSIOLOGICAL_PROFILE_PATH,
  PHYSIOLOGICAL_RESPONSE,
  PHYSIOLOGICAL_RESPONSES,
  PROFILE_PATH,
  PROFILE_WITH_NUTRITION_HABITS,
  PROFILE_WITH_SPORT_HABITS,
  SPORT_HABITS_PATCH_RESPONSES,
  SPORT_HABITS_PATH,
  SPORT_HABITS_RESPONSE,
  SPORT_HABITS_RESPONSES,
  VALID_DEMOGRAPHIC_REQUEST,
  VALID_NUTRITION_HABITS_REQUEST,
  VALID_PHYSIOLOGICAL_REQUEST,
  VALID_SPORT_HABITS_PATCH_REQUEST,
  VALID_SPORT_HABITS_REQUEST,
} from '../../../../testing/bff-web/profile.fixtures';
import { SimulatedResponse } from '../../../../testing/bff-web/register-user.fixtures';
import {
  OpenApiDocument,
  OpenApiOperation,
  responseSchema,
  validateAgainstSchema,
} from '../../../../testing/openapi-schema';
import { APP_CONFIG, AppConfig } from '../../config/app-config';
import contractJson from '../contracts/bff-web.openapi.json';
import { BFF_WEB_CONTRACT_VERSION } from './contract';
import {
  BffWebProfileApi,
  DIET_PATTERNS,
  DIET_RESTRICTIONS,
  DemographicProfileRequestDto,
  DemographicProfileResponseDto,
  FOOD_ALLERGIES,
  GENDERS,
  HABIT_INTENSITIES,
  HABIT_LEVELS,
  HABIT_SPORTS,
  INCOME_RANGES,
  MARITAL_STATUSES,
  MEASURED_AT_PATTERN,
  NUTRITION_HABITS_LIMITS,
  NutritionHabitsRequestDto,
  NutritionHabitsResponseDto,
  PRIMARY_GOALS,
  PROFILE_COUNTRY_CODE_PATTERN,
  PROFILE_DECIMAL_PATTERN,
  PROFILE_ERROR_CODES,
  PROFILE_IDEMPOTENT_REPLAYED_HEADER,
  PROFILE_ISSUES,
  PROFILE_LIMITS,
  PhysiologicalProfileRequestDto,
  PhysiologicalProfileResponseDto,
  ProfileResponseDto,
  SPORT_HABITS_LIMITS,
  SPORT_HABITS_NOT_FOUND,
  SportHabitsPatchRequestDto,
  SportHabitsRequestDto,
  SportHabitsResponseDto,
  TIME_SLOTS,
  VERSION_CONFLICT_FIELD,
  WEEK_DAYS,
} from './profile.api';

type Schema = Record<string, unknown> & {
  properties: Record<string, Record<string, unknown>>;
  required: string[];
};

const contract = contractJson as unknown as OpenApiDocument;
const getOperation: OpenApiOperation = contract.paths[PROFILE_PATH]['get'];
const demographicOperation: OpenApiOperation = contract.paths[DEMOGRAPHIC_PROFILE_PATH]['put'];
const physiologicalOperation: OpenApiOperation = contract.paths[PHYSIOLOGICAL_PROFILE_PATH]['put'];
const sportHabitsOperation: OpenApiOperation = contract.paths[SPORT_HABITS_PATH]['put'];
const patchSportHabitsOperation: OpenApiOperation = contract.paths[SPORT_HABITS_PATH]['patch'];
const nutritionHabitsOperation: OpenApiOperation = contract.paths[NUTRITION_HABITS_PATH]['put'];
const schemas = contract.components.schemas as Record<string, Schema>;

function requestSchema(operation: OpenApiOperation): Schema {
  return operation.requestBody!.content['application/json'].schema as Schema;
}

/** Variante no nula de una propiedad `anyOf: [X, null]`. */
function nonNull(property: Record<string, unknown>): Record<string, unknown> {
  const options = (property['anyOf'] as Record<string, unknown>[] | undefined) ?? [property];
  return options.find((option) => option['type'] !== 'null')!;
}

/**
 * Códigos de error declarados en la descripción de una respuesta. Se descartan
 * el actor (`athlete`) y los motivos de `details` que también aparecen entre
 * comillas invertidas.
 */
function declaredCodes(operation: OpenApiOperation, status: number): string[] {
  const description = operation.responses[String(status)]?.description ?? '';
  return [...description.matchAll(/`([a-z_]+)`/g)]
    .map((match) => match[1])
    .filter((code) => code !== 'athlete' && !(PROFILE_ISSUES as readonly string[]).includes(code));
}

function expectValidResponses(
  operation: OpenApiOperation,
  responses: Record<string, SimulatedResponse>,
): void {
  for (const [name, response] of Object.entries(responses)) {
    expect(
      validateAgainstSchema(contract, responseSchema(operation, response.status), response.body),
    )
      .withContext(`${name} (${response.status})`)
      .toEqual([]);
    if (response.status >= 400) {
      expect(declaredCodes(operation, response.status))
        .withContext(name)
        .toContain((response.body as { code: string }).code);
    }
  }
}

describe('Contrato bff-web: perfil del deportista (HU005, ADR-034)', () => {
  it('usa la versión del contrato y los operationId de las tres operaciones', () => {
    expect(contract.info.version).toBe(BFF_WEB_CONTRACT_VERSION);
    expect(getOperation.operationId).toBe('get_profile_v1_me_profile_get');
    expect(demographicOperation.operationId).toBe('put_demographic_v1_me_demographic_profile_put');
    expect(physiologicalOperation.operationId).toBe(
      'put_physiological_v1_me_physiological_profile_put',
    );
  });

  it('la consulta se autentica con Authorization y los comandos aceptan además Idempotency-Key', () => {
    const headers = (operation: OpenApiOperation) =>
      (operation.parameters ?? []).map((p) => [p.in, p.name.toLowerCase()]);

    expect(headers(getOperation)).toEqual([['header', 'authorization']]);
    for (const operation of [demographicOperation, physiologicalOperation]) {
      expect(headers(operation)).toEqual([
        ['header', 'idempotency-key'],
        ['header', 'authorization'],
      ]);
      for (const status of ['200', '201']) {
        expect(Object.keys(operation.responses[status].headers ?? {})).toContain(
          PROFILE_IDEMPOTENT_REPLAYED_HEADER,
        );
      }
    }
  });

  it('la solicitud demográfica del cliente cumple el esquema y rechaza user_id', () => {
    const schema = requestSchema(demographicOperation);
    const request: DemographicProfileRequestDto = VALID_DEMOGRAPHIC_REQUEST;

    expect(validateAgainstSchema(contract, schema, request)).toEqual([]);
    expect(validateAgainstSchema(contract, schema, { ...request, expected_version: 1 })).toEqual(
      [],
    );
    expect(
      validateAgainstSchema(contract, schema, {
        ...request,
        marital_status: null,
        occupation: null,
        income_range: null,
      }),
    ).toEqual([]);
    expect(validateAgainstSchema(contract, schema, { ...request, user_id: 'x' })).toEqual([
      '$.user_id: propiedad no permitida',
    ]);
    expect([...schema.required].sort()).toEqual(
      ['birth_date', 'city', 'country_code', 'gender'].sort(),
    );
    expect(Object.keys(schema.properties).sort()).toEqual(
      [...Object.keys(request), 'expected_version'].sort(),
    );
  });

  it('la solicitud fisiológica del cliente cumple el esquema y rechaza bmi', () => {
    const schema = requestSchema(physiologicalOperation);
    const request: PhysiologicalProfileRequestDto = VALID_PHYSIOLOGICAL_REQUEST;

    expect(validateAgainstSchema(contract, schema, request)).toEqual([]);
    expect(
      validateAgainstSchema(contract, schema, {
        ...request,
        expected_version: 2,
        resting_heart_rate_bpm: null,
        blood_pressure: null,
        body_temperature_c: null,
      }),
    ).toEqual([]);
    expect(validateAgainstSchema(contract, schema, { ...request, bmi: '23.2' })).toEqual([
      '$.bmi: propiedad no permitida',
    ]);
    expect([...schema.required].sort()).toEqual(
      ['consent', 'height_cm', 'measured_at', 'weight_kg'].sort(),
    );
    expect(Object.keys(schema.properties).sort()).toEqual(
      [...Object.keys(request), 'expected_version'].sort(),
    );
  });

  it('las respuestas del cliente tienen exactamente las propiedades obligatorias del contrato', () => {
    const demographic: DemographicProfileResponseDto = DEMOGRAPHIC_RESPONSE;
    const physiological: PhysiologicalProfileResponseDto = PHYSIOLOGICAL_RESPONSE;
    const profile: ProfileResponseDto = FULL_PROFILE;

    expect(Object.keys(demographic).sort()).toEqual(
      [...schemas['DemographicProfileResponse'].required].sort(),
    );
    expect(Object.keys(physiological).sort()).toEqual(
      [...schemas['PhysiologicalProfileResponse'].required].sort(),
    );
    expect(Object.keys(profile).sort()).toEqual([...schemas['ProfileResponse'].required].sort());
    expect(Object.keys(profile.demographic!).sort()).toEqual(
      [...schemas['DemographicProfileSection'].required].sort(),
    );
    expect(Object.keys(profile.physiological!).sort()).toEqual(
      [...schemas['PhysiologicalProfileSection'].required].sort(),
    );
  });

  it('los catálogos cerrados coinciden con los enum del contrato', () => {
    const body = requestSchema(demographicOperation).properties;

    expect<readonly string[]>(GENDERS).toEqual(body['gender']['enum'] as string[]);
    expect<readonly string[]>(MARITAL_STATUSES).toEqual(
      nonNull(body['marital_status'])['enum'] as string[],
    );
    expect<readonly string[]>(INCOME_RANGES).toEqual(
      nonNull(body['income_range'])['enum'] as string[],
    );
  });

  it('los límites, patrones y rangos documentados coinciden con el contrato', () => {
    const demographic = requestSchema(demographicOperation).properties;
    const physiological = requestSchema(physiologicalOperation).properties;
    const bloodPressure = nonNull(physiological['blood_pressure'])['properties'] as Record<
      string,
      Record<string, unknown>
    >;
    const occupation = nonNull(demographic['occupation']);
    const heartRate = nonNull(physiological['resting_heart_rate_bpm']);
    const temperature = nonNull(physiological['body_temperature_c']);

    expect<number>(PROFILE_LIMITS.cityMin).toBe(demographic['city']['minLength'] as number);
    expect<number>(PROFILE_LIMITS.cityMax).toBe(demographic['city']['maxLength'] as number);
    expect<number>(PROFILE_LIMITS.occupationMin).toBe(occupation['minLength'] as number);
    expect<number>(PROFILE_LIMITS.occupationMax).toBe(occupation['maxLength'] as number);
    expect<number>(PROFILE_LIMITS.heightMin).toBe(physiological['height_cm']['minimum'] as number);
    expect<number>(PROFILE_LIMITS.heightMax).toBe(physiological['height_cm']['maximum'] as number);
    expect<number>(PROFILE_LIMITS.restingHeartRateMin).toBe(heartRate['minimum'] as number);
    expect<number>(PROFILE_LIMITS.restingHeartRateMax).toBe(heartRate['maximum'] as number);
    expect<number>(PROFILE_LIMITS.systolicMin).toBe(
      bloodPressure['systolic_mmhg']['minimum'] as number,
    );
    expect<number>(PROFILE_LIMITS.systolicMax).toBe(
      bloodPressure['systolic_mmhg']['maximum'] as number,
    );
    expect<number>(PROFILE_LIMITS.diastolicMin).toBe(
      bloodPressure['diastolic_mmhg']['minimum'] as number,
    );
    expect<number>(PROFILE_LIMITS.diastolicMax).toBe(
      bloodPressure['diastolic_mmhg']['maximum'] as number,
    );

    expect(PROFILE_COUNTRY_CODE_PATTERN.source).toBe(
      demographic['country_code']['pattern'] as string,
    );
    expect(PROFILE_DECIMAL_PATTERN.source).toBe(physiological['weight_kg']['pattern'] as string);
    expect(PROFILE_DECIMAL_PATTERN.source).toBe(temperature['pattern'] as string);
    expect(MEASURED_AT_PATTERN.source).toBe(physiological['measured_at']['pattern'] as string);

    // Rangos que el contrato solo documenta en las descripciones.
    expect(demographic['birth_date']['description']).toContain(
      `entre ${PROFILE_LIMITS.ageMin} y ${PROFILE_LIMITS.ageMax} años`,
    );
    expect(physiological['weight_kg']['description']).toContain(
      `de ${PROFILE_LIMITS.weightMin} a ${PROFILE_LIMITS.weightMax}`,
    );
    expect(physiological['body_temperature_c']['description']).toContain(
      `de ${PROFILE_LIMITS.bodyTemperatureMin} a ${PROFILE_LIMITS.bodyTemperatureMax}`,
    );
    expect(physiological['measured_at']['description']).toContain(
      `hasta ${PROFILE_LIMITS.measuredAtFutureMinutes} minutos en el futuro y ${PROFILE_LIMITS.measuredAtPastDays} días en el pasado`,
    );
  });

  it('los códigos de error del cliente son los que declaran las operaciones', () => {
    const commandCodes = (operation: OpenApiOperation) =>
      [401, 403, 409, 422, 503, 504].flatMap((status) => declaredCodes(operation, status)).sort();

    expect<string[]>(Object.values(PROFILE_ERROR_CODES).sort()).toEqual(
      commandCodes(demographicOperation),
    );
    expect(commandCodes(physiologicalOperation)).toEqual(commandCodes(demographicOperation));
    expect([401, 403, 503, 504].flatMap((status) => declaredCodes(getOperation, status))).toEqual([
      PROFILE_ERROR_CODES.invalidAccessToken,
      PROFILE_ERROR_CODES.permissionRequired,
      PROFILE_ERROR_CODES.upstreamUnavailable,
      PROFILE_ERROR_CODES.upstreamTimeout,
    ]);
  });

  it('el conflicto de versión informa la versión vigente en details.expected_version', () => {
    for (const operation of [demographicOperation, physiologicalOperation]) {
      expect(operation.responses['409'].description).toContain(
        `field: "${VERSION_CONFLICT_FIELD}", issue: "<versión vigente>"`,
      );
    }
  });

  it('las respuestas simuladas de la consulta cumplen el contrato', () => {
    expectValidResponses(getOperation, GET_PROFILE_RESPONSES);
  });

  it('las respuestas simuladas del comando demográfico cumplen el contrato', () => {
    expectValidResponses(demographicOperation, DEMOGRAPHIC_RESPONSES);
  });

  it('las respuestas simuladas del comando fisiológico cumplen el contrato', () => {
    expectValidResponses(physiologicalOperation, PHYSIOLOGICAL_RESPONSES);
  });
});

describe('Contrato bff-web: hábitos deportivos (HU006, ADR-034)', () => {
  const request = () => requestSchema(sportHabitsOperation);
  const sportItem = () =>
    (request().properties['sports']['items'] as Schema).properties as Record<
      string,
      Record<string, unknown>
    >;
  const availability = () =>
    (request().properties['availability'] as Schema).properties as Record<
      string,
      Record<string, unknown>
    >;

  it('usa el operationId de PUT /v1/me/sport-habits con Authorization e Idempotency-Key', () => {
    expect(sportHabitsOperation.operationId).toBe('put_sport_habits_v1_me_sport_habits_put');
    expect(
      (sportHabitsOperation.parameters ?? []).map((p) => [p.in, p.name.toLowerCase()]),
    ).toEqual([
      ['header', 'idempotency-key'],
      ['header', 'authorization'],
    ]);
    for (const status of ['200', '201']) {
      expect(Object.keys(sportHabitsOperation.responses[status].headers ?? {})).toContain(
        PROFILE_IDEMPOTENT_REPLAYED_HEADER,
      );
    }
  });

  it('la solicitud del cliente cumple el esquema y rechaza user_id', () => {
    const schema = request();
    const body: SportHabitsRequestDto = VALID_SPORT_HABITS_REQUEST;

    expect(validateAgainstSchema(contract, schema, body)).toEqual([]);
    expect(validateAgainstSchema(contract, schema, { ...body, expected_version: 1 })).toEqual([]);
    expect(validateAgainstSchema(contract, schema, { ...body, primary_goal: null })).toEqual([]);
    expect(validateAgainstSchema(contract, schema, { ...body, user_id: 'x' })).toEqual([
      '$.user_id: propiedad no permitida',
    ]);
    expect([...schema.required].sort()).toEqual(['availability', 'sports']);
    expect(Object.keys(schema.properties).sort()).toEqual(
      [...Object.keys(body), 'expected_version'].sort(),
    );
    expect(Object.keys(sportItem()).sort()).toEqual(Object.keys(body.sports[0]).sort());
  });

  it('las respuestas del cliente tienen exactamente las propiedades obligatorias del contrato', () => {
    const response: SportHabitsResponseDto = SPORT_HABITS_RESPONSE;
    const profile: ProfileResponseDto = PROFILE_WITH_SPORT_HABITS;

    expect(Object.keys(response).sort()).toEqual(
      [...schemas['SportHabitsResponse'].required].sort(),
    );
    expect(Object.keys(profile.sport_habits!).sort()).toEqual(
      [...schemas['SportHabitsSection'].required].sort(),
    );
    expect(Object.keys(profile.sport_habits!.sports[0]).sort()).toEqual(
      [...schemas['SportHabitView'].required].sort(),
    );
  });

  it('los catálogos cerrados coinciden con los enum del contrato', () => {
    const item = sportItem();
    const days = availability()['days']['items'] as Record<string, unknown>;
    const slots = availability()['time_slots']['items'] as Record<string, unknown>;

    expect<readonly string[]>(HABIT_SPORTS).toEqual(item['sport']['enum'] as string[]);
    expect<readonly string[]>(HABIT_INTENSITIES).toEqual(item['intensity']['enum'] as string[]);
    expect<readonly string[]>(HABIT_LEVELS).toEqual(item['level']['enum'] as string[]);
    expect<readonly string[]>(WEEK_DAYS).toEqual(days['enum'] as string[]);
    expect<readonly string[]>(TIME_SLOTS).toEqual(slots['enum'] as string[]);
    expect<readonly string[]>(PRIMARY_GOALS).toEqual(
      nonNull(request().properties['primary_goal'])['enum'] as string[],
    );
  });

  it('los límites de listas y enteros coinciden con el contrato', () => {
    const sports = request().properties['sports'];
    const item = sportItem();
    const years = nonNull(item['years_practicing']);
    const { days, time_slots: slots } = availability();

    expect<number>(SPORT_HABITS_LIMITS.sportsMin).toBe(sports['minItems'] as number);
    expect<number>(SPORT_HABITS_LIMITS.sportsMax).toBe(sports['maxItems'] as number);
    expect<number>(SPORT_HABITS_LIMITS.frequencyMin).toBe(
      item['frequency_per_week']['minimum'] as number,
    );
    expect<number>(SPORT_HABITS_LIMITS.frequencyMax).toBe(
      item['frequency_per_week']['maximum'] as number,
    );
    expect<number>(SPORT_HABITS_LIMITS.durationMin).toBe(
      item['session_duration_minutes']['minimum'] as number,
    );
    expect<number>(SPORT_HABITS_LIMITS.durationMax).toBe(
      item['session_duration_minutes']['maximum'] as number,
    );
    expect<number>(SPORT_HABITS_LIMITS.yearsMin).toBe(years['minimum'] as number);
    expect<number>(SPORT_HABITS_LIMITS.yearsMax).toBe(years['maximum'] as number);
    expect<number>(SPORT_HABITS_LIMITS.daysMin).toBe(days['minItems'] as number);
    expect<number>(SPORT_HABITS_LIMITS.daysMax).toBe(days['maxItems'] as number);
    expect<number>(SPORT_HABITS_LIMITS.timeSlotsMin).toBe(slots['minItems'] as number);
    expect<number>(SPORT_HABITS_LIMITS.timeSlotsMax).toBe(slots['maxItems'] as number);
  });

  it('declara los mismos códigos de error y el mismo conflicto de versión que HU005', () => {
    const codes = (operation: OpenApiOperation) =>
      [401, 403, 409, 422, 503, 504].flatMap((status) => declaredCodes(operation, status)).sort();

    expect(codes(sportHabitsOperation)).toEqual(codes(demographicOperation));
    expect(sportHabitsOperation.responses['409'].description).toContain(
      `field: "${VERSION_CONFLICT_FIELD}", issue: "<versión vigente>"`,
    );
  });

  it('los motivos de los 422 simulados son del catálogo de ADR-034', () => {
    for (const response of [
      SPORT_HABITS_RESPONSES.validationError,
      SPORT_HABITS_RESPONSES.tooManySports,
    ]) {
      for (const detail of response.body.details) {
        expect<readonly string[]>(PROFILE_ISSUES).toContain(detail.issue);
      }
    }
  });

  it('las respuestas simuladas del comando cumplen el contrato', () => {
    expectValidResponses(sportHabitsOperation, SPORT_HABITS_RESPONSES);
  });
});

describe('Contrato bff-web: actualización de hábitos deportivos (HU008, ADR-035)', () => {
  const request = () => requestSchema(patchSportHabitsOperation);
  /**
   * El esquema sin su `anyOf` de secciones: `validateAgainstSchema` resuelve el
   * `anyOf` antes que las propiedades, así que las secciones se comprueban aparte.
   */
  const properties = (): Schema => {
    const { anyOf: _sections, ...rest } = request();
    return rest as Schema;
  };

  it('usa el operationId de PATCH /v1/me/sport-habits con Authorization e Idempotency-Key', () => {
    expect(patchSportHabitsOperation.operationId).toBe(
      'patch_sport_habits_v1_me_sport_habits_patch',
    );
    expect(
      (patchSportHabitsOperation.parameters ?? []).map((p) => [p.in, p.name.toLowerCase()]),
    ).toEqual([
      ['header', 'idempotency-key'],
      ['header', 'authorization'],
    ]);
    expect(Object.keys(patchSportHabitsOperation.responses['200'].headers ?? {})).toContain(
      PROFILE_IDEMPOTENT_REPLAYED_HEADER,
    );
  });

  it('exige expected_version y al menos una de las tres secciones', () => {
    const schema = request();

    expect(schema.required).toEqual(['expected_version']);
    expect((schema['anyOf'] as { required: string[] }[]).map((option) => option.required)).toEqual([
      ['sports'],
      ['availability'],
      ['primary_goal'],
    ]);
    expect(Object.keys(schema.properties).sort()).toEqual(
      ['availability', 'expected_version', 'primary_goal', 'sports'].sort(),
    );
  });

  it('las solicitudes parciales del cliente cumplen el esquema y rechazan user_id', () => {
    const body: SportHabitsPatchRequestDto = VALID_SPORT_HABITS_PATCH_REQUEST;
    const availability: SportHabitsPatchRequestDto = {
      expected_version: 1,
      availability: { days: ['TUE'], time_slots: ['EVENING'] },
    };
    const clearGoal: SportHabitsPatchRequestDto = { expected_version: 1, primary_goal: null };

    for (const valid of [body, availability, clearGoal]) {
      expect(validateAgainstSchema(contract, properties(), valid)).toEqual([]);
    }
    expect(validateAgainstSchema(contract, properties(), { ...body, user_id: 'x' })).toEqual([
      '$.user_id: propiedad no permitida',
    ]);
    expect(validateAgainstSchema(contract, properties(), { sports: body.sports })).toEqual([
      '$.expected_version: es obligatorio',
    ]);
  });

  it('cada sección tiene el mismo esquema que en el PUT de HU006', () => {
    const put = requestSchema(sportHabitsOperation).properties;
    const patch = request().properties;

    const sports = nonNull(patch['sports']);
    for (const key of ['items', 'minItems', 'maxItems']) {
      expect(sports[key]).withContext(key).toEqual(put['sports'][key]);
    }
    expect(nonNull(patch['availability'])['properties']).toEqual(
      nonNull(put['availability'])['properties'],
    );
    expect(patch['primary_goal']['anyOf']).toEqual(put['primary_goal']['anyOf']);
  });

  it('declara los códigos del PUT más sport_habits_not_found', () => {
    const codes = (operation: OpenApiOperation) =>
      [401, 403, 404, 409, 422, 503, 504]
        .flatMap((status) => declaredCodes(operation, status))
        .sort();

    expect(codes(patchSportHabitsOperation)).toEqual(
      [...codes(sportHabitsOperation), SPORT_HABITS_NOT_FOUND].sort(),
    );
    expect(declaredCodes(patchSportHabitsOperation, 404)).toEqual([SPORT_HABITS_NOT_FOUND]);
    expect(patchSportHabitsOperation.responses['409'].description).toContain(
      `field: "${VERSION_CONFLICT_FIELD}", issue: "<versión vigente>"`,
    );
  });

  it('los motivos de los 422 simulados son del catálogo de ADR-034', () => {
    for (const response of [
      SPORT_HABITS_PATCH_RESPONSES.validationError,
      SPORT_HABITS_PATCH_RESPONSES.noSections,
    ]) {
      for (const detail of response.body.details) {
        expect<readonly string[]>(PROFILE_ISSUES).toContain(detail.issue);
      }
    }
  });

  it('las respuestas simuladas del comando cumplen el contrato', () => {
    expectValidResponses(patchSportHabitsOperation, SPORT_HABITS_PATCH_RESPONSES);
  });
});

describe('Contrato bff-web: hábitos alimenticios (HU009, ADR-035)', () => {
  const request = () => requestSchema(nutritionHabitsOperation);

  it('usa el operationId de PUT /v1/me/nutrition-habits con Authorization e Idempotency-Key', () => {
    expect(nutritionHabitsOperation.operationId).toBe(
      'put_nutrition_habits_v1_me_nutrition_habits_put',
    );
    expect(
      (nutritionHabitsOperation.parameters ?? []).map((p) => [p.in, p.name.toLowerCase()]),
    ).toEqual([
      ['header', 'idempotency-key'],
      ['header', 'authorization'],
    ]);
    for (const status of ['200', '201']) {
      expect(Object.keys(nutritionHabitsOperation.responses[status].headers ?? {})).toContain(
        PROFILE_IDEMPOTENT_REPLAYED_HEADER,
      );
    }
  });

  it('la solicitud del cliente cumple el esquema, exige el consentimiento y rechaza user_id', () => {
    const schema = request();
    const body: NutritionHabitsRequestDto = VALID_NUTRITION_HABITS_REQUEST;

    expect(validateAgainstSchema(contract, schema, body)).toEqual([]);
    expect(
      validateAgainstSchema(contract, schema, {
        ...body,
        expected_version: 1,
        restrictions: [],
        allergies: [],
        hydration_liters_per_day: null,
      }),
    ).toEqual([]);
    expect(validateAgainstSchema(contract, schema, { ...body, user_id: 'x' })).toEqual([
      '$.user_id: propiedad no permitida',
    ]);
    expect([...schema.required].sort()).toEqual(
      ['allergies', 'consent', 'diet_pattern', 'meals_per_day', 'restrictions'].sort(),
    );
    expect(Object.keys(schema.properties).sort()).toEqual(
      [...Object.keys(body), 'expected_version'].sort(),
    );
  });

  it('las respuestas del cliente tienen exactamente las propiedades obligatorias del contrato', () => {
    const response: NutritionHabitsResponseDto = NUTRITION_HABITS_RESPONSE;
    const profile: ProfileResponseDto = PROFILE_WITH_NUTRITION_HABITS;

    expect(Object.keys(response).sort()).toEqual(
      [...schemas['NutritionHabitsResponse'].required].sort(),
    );
    expect(Object.keys(profile).sort()).toEqual([...schemas['ProfileResponse'].required].sort());
    expect(Object.keys(profile.nutrition_habits!).sort()).toEqual(
      [...schemas['NutritionHabitsSection'].required].sort(),
    );
    expect(Object.keys(profile.versions).sort()).toEqual(
      [...schemas['ProfileVersions'].required].sort(),
    );
  });

  it('los catálogos cerrados coinciden con los enum del contrato', () => {
    const body = request().properties;

    expect<readonly string[]>(DIET_PATTERNS).toEqual(body['diet_pattern']['enum'] as string[]);
    expect<readonly string[]>(DIET_RESTRICTIONS).toEqual(
      (body['restrictions']['items'] as Record<string, unknown>)['enum'] as string[],
    );
    expect<readonly string[]>(FOOD_ALLERGIES).toEqual(
      (body['allergies']['items'] as Record<string, unknown>)['enum'] as string[],
    );
  });

  it('los límites, el patrón y el rango de la hidratación coinciden con el contrato', () => {
    const body = request().properties;
    const hydration = nonNull(body['hydration_liters_per_day']);

    expect<number>(NUTRITION_HABITS_LIMITS.restrictionsMax).toBe(
      body['restrictions']['maxItems'] as number,
    );
    expect<number>(NUTRITION_HABITS_LIMITS.allergiesMax).toBe(
      body['allergies']['maxItems'] as number,
    );
    expect<number>(NUTRITION_HABITS_LIMITS.mealsMin).toBe(
      body['meals_per_day']['minimum'] as number,
    );
    expect<number>(NUTRITION_HABITS_LIMITS.mealsMax).toBe(
      body['meals_per_day']['maximum'] as number,
    );
    expect(PROFILE_DECIMAL_PATTERN.source).toBe(hydration['pattern'] as string);
    expect(body['hydration_liters_per_day']['description']).toContain(
      `de ${NUTRITION_HABITS_LIMITS.hydrationMin} a ${NUTRITION_HABITS_LIMITS.hydrationMax} litros`,
    );
  });

  it('declara los mismos códigos de error y el mismo conflicto de versión que HU005', () => {
    const codes = (operation: OpenApiOperation) =>
      [401, 403, 409, 422, 503, 504].flatMap((status) => declaredCodes(operation, status)).sort();

    expect(codes(nutritionHabitsOperation)).toEqual(codes(demographicOperation));
    expect(nutritionHabitsOperation.responses['409'].description).toContain(
      `field: "${VERSION_CONFLICT_FIELD}", issue: "<versión vigente>"`,
    );
  });

  it('los motivos de los 422 simulados son del catálogo de ADR-034', () => {
    for (const response of [
      NUTRITION_HABITS_RESPONSES.validationError,
      NUTRITION_HABITS_RESPONSES.unsupportedConsentVersion,
      NUTRITION_HABITS_RESPONSES.unknownRestriction,
    ]) {
      for (const detail of response.body.details) {
        expect<readonly string[]>(PROFILE_ISSUES).toContain(detail.issue);
      }
    }
  });

  it('las respuestas simuladas del comando cumplen el contrato', () => {
    expectValidResponses(nutritionHabitsOperation, NUTRITION_HABITS_RESPONSES);
  });
});

describe('BffWebProfileApi', () => {
  let api: BffWebProfileApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: APP_CONFIG,
          useValue: {
            environment: 'local',
            bffWebBaseUrl: 'http://bff.test/',
            registrationPoliciesVersion: null,
            healthDataConsentVersion: null,
          } satisfies AppConfig,
        },
      ],
    });
    api = TestBed.inject(BffWebProfileApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('consulta el perfil con el token', () => {
    let profile: ProfileResponseDto | null = null;
    api.getProfile('token-sintetico').subscribe((response) => (profile = response));

    const request = http.expectOne('http://bff.test/v1/me/profile');
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-sintetico');
    request.flush(FULL_PROFILE);
    expect(profile!).toEqual(FULL_PROFILE);
  });

  it('reemplaza la sección demográfica con token, Idempotency-Key y la respuesta completa', () => {
    let status = 0;
    api
      .putDemographicProfile('token-sintetico', VALID_DEMOGRAPHIC_REQUEST, 'clave-uuid')
      .subscribe((response) => (status = response.status));

    const request = http.expectOne('http://bff.test/v1/me/demographic-profile');
    expect(request.request.method).toBe('PUT');
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-sintetico');
    expect(request.request.headers.get('Idempotency-Key')).toBe('clave-uuid');
    expect(request.request.body).toEqual(VALID_DEMOGRAPHIC_REQUEST);
    request.flush(DEMOGRAPHIC_RESPONSE, { status: 201, statusText: 'Created' });
    expect(status).toBe(201);
  });

  it('reemplaza la sección fisiológica con token, Idempotency-Key y la respuesta completa', () => {
    let status = 0;
    api
      .putPhysiologicalProfile('token-sintetico', VALID_PHYSIOLOGICAL_REQUEST, 'clave-uuid')
      .subscribe((response) => (status = response.status));

    const request = http.expectOne('http://bff.test/v1/me/physiological-profile');
    expect(request.request.method).toBe('PUT');
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-sintetico');
    expect(request.request.headers.get('Idempotency-Key')).toBe('clave-uuid');
    expect(request.request.body).toEqual(VALID_PHYSIOLOGICAL_REQUEST);
    request.flush(PHYSIOLOGICAL_RESPONSE, { status: 200, statusText: 'OK' });
    expect(status).toBe(200);
  });

  it('reemplaza los hábitos alimenticios con token, Idempotency-Key y la respuesta completa', () => {
    let status = 0;
    api
      .putNutritionHabits('token-sintetico', VALID_NUTRITION_HABITS_REQUEST, 'clave-uuid')
      .subscribe((response) => (status = response.status));

    const request = http.expectOne('http://bff.test/v1/me/nutrition-habits');
    expect(request.request.method).toBe('PUT');
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-sintetico');
    expect(request.request.headers.get('Idempotency-Key')).toBe('clave-uuid');
    expect(request.request.body).toEqual(VALID_NUTRITION_HABITS_REQUEST);
    request.flush(NUTRITION_HABITS_RESPONSE, { status: 201, statusText: 'Created' });
    expect(status).toBe(201);
  });

  it('actualiza parcialmente los hábitos deportivos con PATCH, token e Idempotency-Key', () => {
    let status = 0;
    api
      .patchSportHabits('token-sintetico', VALID_SPORT_HABITS_PATCH_REQUEST, 'clave-uuid')
      .subscribe((response) => (status = response.status));

    const request = http.expectOne('http://bff.test/v1/me/sport-habits');
    expect(request.request.method).toBe('PATCH');
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-sintetico');
    expect(request.request.headers.get('Idempotency-Key')).toBe('clave-uuid');
    expect(request.request.body).toEqual(VALID_SPORT_HABITS_PATCH_REQUEST);
    request.flush(SPORT_HABITS_PATCH_RESPONSES.updated.body, { status: 200, statusText: 'OK' });
    expect(status).toBe(200);
  });

  it('reemplaza los hábitos deportivos con token, Idempotency-Key y la respuesta completa', () => {
    let status = 0;
    api
      .putSportHabits('token-sintetico', VALID_SPORT_HABITS_REQUEST, 'clave-uuid')
      .subscribe((response) => (status = response.status));

    const request = http.expectOne('http://bff.test/v1/me/sport-habits');
    expect(request.request.method).toBe('PUT');
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-sintetico');
    expect(request.request.headers.get('Idempotency-Key')).toBe('clave-uuid');
    expect(request.request.body).toEqual(VALID_SPORT_HABITS_REQUEST);
    request.flush(SPORT_HABITS_RESPONSE, { status: 201, statusText: 'Created' });
    expect(status).toBe(201);
  });
});
