import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import {
  DEMOGRAPHIC_PROFILE_PATH,
  DEMOGRAPHIC_RESPONSE,
  DEMOGRAPHIC_RESPONSES,
  FULL_PROFILE,
  GET_PROFILE_RESPONSES,
  PHYSIOLOGICAL_PROFILE_PATH,
  PHYSIOLOGICAL_RESPONSE,
  PHYSIOLOGICAL_RESPONSES,
  PROFILE_PATH,
  VALID_DEMOGRAPHIC_REQUEST,
  VALID_PHYSIOLOGICAL_REQUEST,
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
  DemographicProfileRequestDto,
  DemographicProfileResponseDto,
  GENDERS,
  INCOME_RANGES,
  MARITAL_STATUSES,
  MEASURED_AT_PATTERN,
  PROFILE_COUNTRY_CODE_PATTERN,
  PROFILE_DECIMAL_PATTERN,
  PROFILE_ERROR_CODES,
  PROFILE_IDEMPOTENT_REPLAYED_HEADER,
  PROFILE_ISSUES,
  PROFILE_LIMITS,
  PhysiologicalProfileRequestDto,
  PhysiologicalProfileResponseDto,
  ProfileResponseDto,
  VERSION_CONFLICT_FIELD,
} from './profile.api';

type Schema = Record<string, unknown> & {
  properties: Record<string, Record<string, unknown>>;
  required: string[];
};

const contract = contractJson as unknown as OpenApiDocument;
const getOperation: OpenApiOperation = contract.paths[PROFILE_PATH]['get'];
const demographicOperation: OpenApiOperation = contract.paths[DEMOGRAPHIC_PROFILE_PATH]['put'];
const physiologicalOperation: OpenApiOperation = contract.paths[PHYSIOLOGICAL_PROFILE_PATH]['put'];
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
});
