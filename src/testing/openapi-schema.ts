/**
 * Validador mínimo de esquemas OpenAPI 3.1 para pruebas de contrato. Cubre solo
 * las construcciones que usan los contratos consumidos ($ref local, type, enum,
 * const, anyOf, properties, required, additionalProperties: false, items,
 * minLength, maxLength y los formatos uuid, date-time y email).
 * Solo para pruebas: no forma parte de la aplicación.
 */

type Schema = Readonly<Record<string, unknown>>;

export interface OpenApiDocument {
  readonly info: { readonly version: string };
  readonly paths: Readonly<Record<string, Readonly<Record<string, OpenApiOperation>>>>;
  readonly components: { readonly schemas: Readonly<Record<string, Schema>> };
}

export interface OpenApiOperation {
  readonly operationId: string;
  readonly parameters?: readonly {
    readonly in: string;
    readonly name: string;
    readonly required?: boolean;
    readonly schema: Schema;
  }[];
  readonly requestBody?: {
    readonly content: Readonly<Record<string, { readonly schema: Schema }>>;
  };
  readonly responses: Readonly<
    Record<
      string,
      {
        readonly description: string;
        readonly content?: Readonly<Record<string, { readonly schema: Schema }>>;
      }
    >
  >;
}

const FORMATS: Readonly<Record<string, RegExp>> = {
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  'date-time': /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/,
  email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/,
};

/** Devuelve la lista de incumplimientos; vacía si el valor cumple el esquema. */
export function validateAgainstSchema(
  document: OpenApiDocument,
  schema: Schema,
  value: unknown,
  path = '$',
): string[] {
  const resolved = resolve(document, schema);

  if ('anyOf' in resolved) {
    const options = resolved['anyOf'] as Schema[];
    const matches = options.some(
      (option) => validateAgainstSchema(document, option, value, path).length === 0,
    );
    return matches ? [] : [`${path}: no cumple ninguna opción de anyOf`];
  }
  if ('const' in resolved && value !== resolved['const']) {
    return [`${path}: se esperaba ${JSON.stringify(resolved['const'])}`];
  }
  if ('enum' in resolved && !(resolved['enum'] as unknown[]).includes(value)) {
    return [`${path}: ${JSON.stringify(value)} no está en el enum`];
  }

  switch (resolved['type']) {
    case 'object':
      return validateObject(document, resolved, value, path);
    case 'array':
      if (!Array.isArray(value)) return [`${path}: se esperaba un arreglo`];
      return value.flatMap((item, index) =>
        validateAgainstSchema(document, resolved['items'] as Schema, item, `${path}[${index}]`),
      );
    case 'string':
      return validateString(resolved, value, path);
    case 'integer':
      return Number.isInteger(value) ? [] : [`${path}: se esperaba un entero`];
    case 'null':
      return value === null ? [] : [`${path}: se esperaba null`];
    default:
      return [];
  }
}

/** Esquema del cuerpo de respuesta `application/json` para un estado HTTP. */
export function responseSchema(operation: OpenApiOperation, status: number): Schema {
  const response = operation.responses[String(status)];
  if (!response?.content?.['application/json']) {
    throw new Error(`El contrato no declara la respuesta ${status} con cuerpo JSON`);
  }
  return response.content['application/json'].schema;
}

function resolve(document: OpenApiDocument, schema: Schema): Schema {
  const ref = schema['$ref'];
  if (typeof ref !== 'string') {
    return schema;
  }
  const name = ref.replace('#/components/schemas/', '');
  const target = document.components.schemas[name];
  if (!target) {
    throw new Error(`Referencia no resuelta: ${ref}`);
  }
  return target;
}

function validateObject(
  document: OpenApiDocument,
  schema: Schema,
  value: unknown,
  path: string,
): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [`${path}: se esperaba un objeto`];
  }
  const record = value as Record<string, unknown>;
  const properties = (schema['properties'] ?? {}) as Record<string, Schema>;
  const required = (schema['required'] ?? []) as string[];
  const problems = required
    .filter((name) => !(name in record))
    .map((name) => `${path}.${name}: es obligatorio`);

  for (const [name, item] of Object.entries(record)) {
    const propertySchema = properties[name];
    if (!propertySchema) {
      if (schema['additionalProperties'] === false) {
        problems.push(`${path}.${name}: propiedad no permitida`);
      }
      continue;
    }
    problems.push(...validateAgainstSchema(document, propertySchema, item, `${path}.${name}`));
  }
  return problems;
}

function validateString(schema: Schema, value: unknown, path: string): string[] {
  if (typeof value !== 'string') {
    return [`${path}: se esperaba un texto`];
  }
  const problems: string[] = [];
  const minLength = schema['minLength'];
  const maxLength = schema['maxLength'];
  if (typeof minLength === 'number' && value.length < minLength) {
    problems.push(`${path}: menos de ${minLength} caracteres`);
  }
  if (typeof maxLength === 'number' && value.length > maxLength) {
    problems.push(`${path}: más de ${maxLength} caracteres`);
  }
  const format = FORMATS[schema['format'] as string];
  if (format && !format.test(value)) {
    problems.push(`${path}: no cumple el formato ${String(schema['format'])}`);
  }
  return problems;
}
