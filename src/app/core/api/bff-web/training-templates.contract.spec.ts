import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { SimulatedResponse } from '../../../../testing/bff-web/register-user.fixtures';
import {
  MY_TEMPLATES_PATH,
  MY_TEMPLATES_RESPONSES,
  PUBLISH_TEMPLATE_RESPONSES,
  RETIRE_TEMPLATE_PATH,
  RETIRE_TEMPLATE_RESPONSES,
  TEMPLATES_NEXT_CURSOR,
  TEMPLATES_PATH,
  VALID_PUBLISH_TEMPLATE_REQUEST,
  professionalTemplate,
} from '../../../../testing/bff-web/training-templates.fixtures';
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
  BffWebTrainingTemplatesApi,
  MY_TEMPLATES_ERROR_CODES,
  PUBLISH_TEMPLATE_ERROR_CODES,
  PublishTemplateRequestDto,
  RETIRE_TEMPLATE_ERROR_CODES,
  TEMPLATE_DAYS,
  TEMPLATE_GOALS,
  TEMPLATE_IDEMPOTENT_REPLAYED_HEADER,
  TEMPLATE_LEVELS,
  TEMPLATE_LIMITS,
  TEMPLATE_SPORTS,
  TEMPLATE_STATUSES,
  TemplateResponseDto,
  TemplatesResponseDto,
} from './training-templates.api';

type Schema = Record<string, unknown> & {
  properties: Record<string, Record<string, unknown>>;
  required: string[];
};

const contract = contractJson as unknown as OpenApiDocument;
const schemas = contract.components.schemas as Record<string, Schema>;
const operations = {
  publish: contract.paths[TEMPLATES_PATH]['post'],
  retire: contract.paths[RETIRE_TEMPLATE_PATH]['post'],
  list: contract.paths[MY_TEMPLATES_PATH]['get'],
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

describe('Contrato bff-web: plantillas de plan del profesional (HU028, ADR-041)', () => {
  it('usa la versión del contrato y los operationId', () => {
    expect(contract.info.version).toBe(BFF_WEB_CONTRACT_VERSION);
    expect(operations.publish.operationId).toBe('publish_template_v1_training_plan_templates_post');
    expect(operations.retire.operationId).toBe(
      'retire_template_v1_training_plan_templates__template_id__retire_post',
    );
    expect(operations.list.operationId).toBe('my_templates_v1_me_training_plan_templates_get');
  });

  it('publicar exige Idempotency-Key y expone Idempotent-Replayed; retirar y listar solo el token', () => {
    expect(headers(operations.publish)).toEqual([
      ['idempotency-key', 'true'],
      ['authorization', 'false'],
    ]);
    expect(Object.keys(operations.publish.responses['201'].headers ?? {})).toContain(
      TEMPLATE_IDEMPOTENT_REPLAYED_HEADER,
    );
    expect(headers(operations.retire)).toEqual([['authorization', 'false']]);
    expect(headers(operations.list)).toEqual([['authorization', 'false']]);
    expect(
      (operations.list.parameters ?? []).filter((p) => p.in === 'query').map((p) => p.name),
    ).toEqual(['limit', 'cursor']);
  });

  it('la solicitud del cliente cumple el esquema y rechaza professional_id', () => {
    const schema = operations.publish.requestBody!.content['application/json'].schema;
    const body: PublishTemplateRequestDto = VALID_PUBLISH_TEMPLATE_REQUEST;

    expect(validateAgainstSchema(contract, schema, body)).toEqual([]);
    expect(validateAgainstSchema(contract, schema, { ...body, professional_id: 'x' })).toEqual([
      '$.professional_id: propiedad no permitida',
    ]);
    expect(Object.keys(body).sort()).toEqual(
      Object.keys(schemas['PublishTemplateRequest'].properties).sort(),
    );
    expect(Object.keys(body.weekly_sessions[0]).sort()).toEqual(
      requiredProperties('WeeklySessionRequest'),
    );
    expect(requiredProperties('RetireTemplateRequest')).toEqual(['expected_version']);
  });

  it('las respuestas del cliente tienen exactamente las propiedades obligatorias del contrato', () => {
    const template: TemplateResponseDto = professionalTemplate(0);
    const page: TemplatesResponseDto = MY_TEMPLATES_RESPONSES.firstPage.body;

    expect(Object.keys(template).sort()).toEqual(requiredProperties('TemplateResponse'));
    expect(Object.keys(page).sort()).toEqual(requiredProperties('TemplatesResponse'));
    expect(Object.keys(template.weekly_sessions[0]).sort()).toEqual(
      requiredProperties('WeeklySessionResponse'),
    );
  });

  it('los catálogos cerrados y los límites coinciden con el contrato', () => {
    const body = schemas['PublishTemplateRequest'].properties;
    const session = schemas['WeeklySessionRequest'].properties;

    expect<readonly string[]>(TEMPLATE_SPORTS).toEqual(schemas['Sport']['enum'] as string[]);
    expect<readonly string[]>(TEMPLATE_GOALS).toEqual(schemas['Goal']['enum'] as string[]);
    expect<readonly string[]>(TEMPLATE_LEVELS).toEqual(schemas['Level']['enum'] as string[]);
    expect<readonly string[]>(TEMPLATE_DAYS).toEqual(schemas['DayOfWeek']['enum'] as string[]);
    expect<readonly string[]>(TEMPLATE_STATUSES).toEqual(
      schemas['TemplateResponse'].properties['status']['enum'] as string[],
    );
    expect<number>(TEMPLATE_LIMITS.titleMin).toBe(body['title']['minLength'] as number);
    expect<number>(TEMPLATE_LIMITS.titleMax).toBe(body['title']['maxLength'] as number);
    expect<number>(TEMPLATE_LIMITS.objectivesMin).toBe(body['objectives']['minLength'] as number);
    expect<number>(TEMPLATE_LIMITS.objectivesMax).toBe(body['objectives']['maxLength'] as number);
    expect<number>(TEMPLATE_LIMITS.weeksMin).toBe(body['duration_weeks']['minimum'] as number);
    expect<number>(TEMPLATE_LIMITS.weeksMax).toBe(body['duration_weeks']['maximum'] as number);
    expect<number>(TEMPLATE_LIMITS.sessionsMin).toBe(body['weekly_sessions']['minItems'] as number);
    expect<number>(TEMPLATE_LIMITS.sessionsMax).toBe(body['weekly_sessions']['maxItems'] as number);
    expect<number>(TEMPLATE_LIMITS.sessionDescriptionMin).toBe(
      session['description']['minLength'] as number,
    );
    expect<number>(TEMPLATE_LIMITS.sessionDescriptionMax).toBe(
      session['description']['maxLength'] as number,
    );
    expect<number>(TEMPLATE_LIMITS.sessionMinutesMin).toBe(
      session['duration_minutes']['minimum'] as number,
    );
    expect<number>(TEMPLATE_LIMITS.sessionMinutesMax).toBe(
      session['duration_minutes']['maximum'] as number,
    );
    const limit = (operations.list.parameters ?? []).find((p) => p.name === 'limit')!;
    expect(limit.schema['description']).toContain(
      `de ${TEMPLATE_LIMITS.listMin} a ${TEMPLATE_LIMITS.listMax}; ${TEMPLATE_LIMITS.listDefault} por defecto`,
    );
  });

  it('los códigos de error del cliente son los que declaran las operaciones', () => {
    expect<string[]>(Object.values(PUBLISH_TEMPLATE_ERROR_CODES).sort()).toEqual(
      declaredCodes(operations.publish, [401, 403, 409, 422, 503, 504]),
    );
    expect<string[]>(Object.values(RETIRE_TEMPLATE_ERROR_CODES).sort()).toEqual(
      declaredCodes(operations.retire, [401, 403, 404, 409, 422, 503, 504]),
    );
    expect<string[]>(Object.values(MY_TEMPLATES_ERROR_CODES).sort()).toEqual(
      declaredCodes(operations.list, [401, 403, 422, 503, 504]),
    );
    expect(operations.retire.responses['409'].description).toContain(
      '`{field: expected_version, issue: <versión vigente>}`',
    );
  });

  it('las respuestas simuladas cumplen el contrato', () => {
    expectValid(operations.publish, PUBLISH_TEMPLATE_RESPONSES);
    expectValid(operations.retire, RETIRE_TEMPLATE_RESPONSES);
    expectValid(operations.list, MY_TEMPLATES_RESPONSES);
  });
});

describe('BffWebTrainingTemplatesApi', () => {
  let api: BffWebTrainingTemplatesApi;
  let http: HttpTestingController;
  const template = professionalTemplate(0);

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
    api = TestBed.inject(BffWebTrainingTemplatesApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('publica con token, Idempotency-Key y la respuesta completa', () => {
    let replayed: string | null = null;
    api
      .publishTemplate('token-sintetico', VALID_PUBLISH_TEMPLATE_REQUEST, 'clave-uuid')
      .subscribe((response) => (replayed = response.headers.get('Idempotent-Replayed')));

    const request = http.expectOne('http://bff.test/v1/training-plan-templates');
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-sintetico');
    expect(request.request.headers.get('Idempotency-Key')).toBe('clave-uuid');
    expect(request.request.body).toEqual(VALID_PUBLISH_TEMPLATE_REQUEST);
    request.flush(template, {
      status: 201,
      statusText: 'Created',
      headers: { 'Idempotent-Replayed': 'true' },
    });
    expect(replayed!).toBe('true');
  });

  it('retira con la versión esperada', () => {
    api
      .retireTemplate('token-sintetico', template.template_id, { expected_version: 1 })
      .subscribe();

    const request = http.expectOne(
      `http://bff.test/v1/training-plan-templates/${template.template_id}/retire`,
    );
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-sintetico');
    expect(request.request.body).toEqual({ expected_version: 1 });
    request.flush(RETIRE_TEMPLATE_RESPONSES.retired.body);
  });

  it('lista con el tamaño y el cursor sin modificar', () => {
    const cursor = `${TEMPLATES_NEXT_CURSOR}+/=`;
    api.getMyTemplates('token-sintetico', { limit: 20, cursor }).subscribe();

    const request = http.expectOne(
      (r) => r.url === 'http://bff.test/v1/me/training-plan-templates',
    );
    expect(request.request.params.get('limit')).toBe('20');
    expect(request.request.params.get('cursor')).toBe(cursor);
    request.flush(MY_TEMPLATES_RESPONSES.lastPage.body);
  });

  it('no envía los parámetros ausentes', () => {
    api.getMyTemplates('token-sintetico', { limit: null, cursor: null }).subscribe();

    const request = http.expectOne(
      (r) => r.url === 'http://bff.test/v1/me/training-plan-templates',
    );
    expect(request.request.params.keys()).toEqual([]);
    request.flush(MY_TEMPLATES_RESPONSES.empty.body);
  });
});
